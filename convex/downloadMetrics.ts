import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./functions";
import { getClientIp } from "./lib/httpRateLimit";
import { insertStatEvent } from "./skillStatEvents";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const MONDAY_EPOCH_OFFSET_MS = 4 * DAY_MS;
const DEDUPE_RETENTION_MS = 14 * DAY_MS;
const PRUNE_BATCH_SIZE = 200;
const DEFAULT_SNAPSHOT_PAGE_SIZE = 500;
const SNAPSHOT_WRITE_BATCH_SIZE = 200;
const HMAC_SECRET_ENV = "DOWNLOAD_METERING_HMAC_SECRET";

const targetKindValidator = v.union(v.literal("skill"), v.literal("package"));
const identityKindValidator = v.union(v.literal("user"), v.literal("ip"));

const targetValidator = v.union(
  v.object({ kind: v.literal("skill"), id: v.id("skills") }),
  v.object({ kind: v.literal("package"), id: v.id("packages") }),
);

const weeklySnapshotInputValidator = v.object({
  targetKind: targetKindValidator,
  targetId: v.string(),
  downloads: v.number(),
});

const encoder = new TextEncoder();

type DownloadIdentityKind = "user" | "ip";
type DownloadTargetKind = "skill" | "package";

type DownloadIdentity = {
  identityKind: DownloadIdentityKind;
  identityValue: string;
};

type DailyRollupForSnapshot = {
  targetKind: DownloadTargetKind;
  targetId: string;
  downloads: number;
};

type WeeklySnapshotInput = DailyRollupForSnapshot;

type DailyRollupsPage = {
  page: DailyRollupForSnapshot[];
  isDone: boolean;
  continueCursor: string;
};

type SnapshotResult = {
  weekStart: number;
  targetCount: number;
  downloads: number;
};

export function getDownloadIdentity(
  request: Request,
  userId: string | null,
): DownloadIdentity | null {
  if (userId) return { identityKind: "user", identityValue: userId };
  const ip = getClientIp(request);
  if (!ip) return null;
  return { identityKind: "ip", identityValue: ip };
}

export async function buildDownloadMetricArgs(params: {
  target: { kind: "skill"; id: Id<"skills"> } | { kind: "package"; id: Id<"packages"> };
  identity: DownloadIdentity;
  now: number;
}) {
  return {
    target: params.target,
    identityKind: params.identity.identityKind,
    identityHash: await hashDownloadIdentity(
      params.identity.identityKind,
      params.identity.identityValue,
    ),
    dayStart: getDayStart(params.now),
    occurredAt: params.now,
  };
}

export const recordDownloadMetricInternal = internalMutation({
  args: {
    target: targetValidator,
    identityKind: identityKindValidator,
    identityHash: v.string(),
    dayStart: v.number(),
    occurredAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const targetId = args.target.id;
    const existing = await ctx.db
      .query("downloadMetricDedupes")
      .withIndex("by_target_identity_day", (q) =>
        q
          .eq("targetKind", args.target.kind)
          .eq("targetId", targetId)
          .eq("identityKind", args.identityKind)
          .eq("identityHash", args.identityHash)
          .eq("dayStart", args.dayStart),
      )
      .unique();
    if (existing) return;

    const now = Date.now();
    await ctx.db.insert("downloadMetricDedupes", {
      targetKind: args.target.kind,
      targetId,
      identityKind: args.identityKind,
      identityHash: args.identityHash,
      dayStart: args.dayStart,
      createdAt: now,
    });

    await appendDailyMetricRow(ctx, {
      targetKind: args.target.kind,
      targetId,
      dayStart: args.dayStart,
      now,
    });

    if (args.target.kind === "skill") {
      await insertStatEvent(ctx, {
        skillId: args.target.id,
        kind: "download",
        occurredAt: args.occurredAt,
      });
      return;
    }

    await ctx.db.insert("packageStatEvents", {
      packageId: args.target.id,
      kind: "download",
      occurredAt: args.occurredAt ?? now,
      processedAt: undefined,
    });
  },
});

export const pruneDownloadMetricDedupesInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoffDayStart = getDayStart(Date.now() - DEDUPE_RETENTION_MS);
    const stale = await ctx.db
      .query("downloadMetricDedupes")
      .withIndex("by_day", (q) => q.lt("dayStart", cutoffDayStart))
      .take(PRUNE_BATCH_SIZE);

    for (const entry of stale) {
      await ctx.db.delete(entry._id);
    }

    const hasMore = stale.length === PRUNE_BATCH_SIZE;
    if (hasMore) {
      await ctx.scheduler.runAfter(
        0,
        internal.downloadMetrics.pruneDownloadMetricDedupesInternal,
        {},
      );
    }

    return { deleted: stale.length, hasMore };
  },
});

export const listDailyRollupsForSnapshotInternal = internalQuery({
  args: {
    weekStart: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const weekEnd = args.weekStart + WEEK_MS;
    return await ctx.db
      .query("downloadMetricDailyRollups")
      .withIndex("by_day", (q) => q.gte("dayStart", args.weekStart).lt("dayStart", weekEnd))
      .paginate(args.paginationOpts);
  },
});

export const writeWeeklyTargetSnapshotsInternal = internalMutation({
  args: {
    weekStart: v.number(),
    snapshots: v.array(weeklySnapshotInputValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const snapshot of args.snapshots) {
      const existing = await ctx.db
        .query("downloadMetricWeeklySnapshots")
        .withIndex("by_target_week", (q) =>
          q
            .eq("targetKind", snapshot.targetKind)
            .eq("targetId", snapshot.targetId)
            .eq("weekStart", args.weekStart),
        )
        .unique();
      const fields = {
        targetKind: snapshot.targetKind,
        targetId: snapshot.targetId,
        weekStart: args.weekStart,
        downloads: snapshot.downloads,
        updatedAt: now,
      };
      if (existing) {
        await ctx.db.patch(existing._id, fields);
      } else {
        await ctx.db.insert("downloadMetricWeeklySnapshots", fields);
      }
    }
    return { snapshotsWritten: args.snapshots.length };
  },
});

export const writeGlobalWeeklySnapshotInternal = internalMutation({
  args: {
    weekStart: v.number(),
    downloads: v.number(),
    targetCount: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("downloadMetricGlobalWeeklySnapshots")
      .withIndex("by_week", (q) => q.eq("weekStart", args.weekStart))
      .unique();
    const fields = {
      weekStart: args.weekStart,
      downloads: args.downloads,
      targetCount: args.targetCount,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("downloadMetricGlobalWeeklySnapshots", fields);
    }
  },
});

export const snapshotDownloadMetricsForWeekInternal = internalAction({
  args: {
    weekStart: v.number(),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SnapshotResult> => {
    return await snapshotDownloadMetricsForWeek(
      ctx,
      args.weekStart,
      normalizeSnapshotPageSize(args.pageSize),
    );
  },
});

export const snapshotPreviousWeekDownloadMetricsInternal = internalAction({
  args: {},
  handler: async (ctx): Promise<SnapshotResult> => {
    return await snapshotDownloadMetricsForWeek(
      ctx,
      getWeekStart(Date.now()) - WEEK_MS,
      DEFAULT_SNAPSHOT_PAGE_SIZE,
    );
  },
});

async function appendDailyMetricRow(
  ctx: MutationCtx,
  params: {
    targetKind: DownloadTargetKind;
    targetId: string;
    dayStart: number;
    now: number;
  },
) {
  await ctx.db.insert("downloadMetricDailyRollups", {
    targetKind: params.targetKind,
    targetId: params.targetId,
    dayStart: params.dayStart,
    downloads: 1,
    updatedAt: params.now,
  });
}

async function snapshotDownloadMetricsForWeek(
  ctx: ActionCtx,
  weekStart: number,
  pageSize: number,
): Promise<SnapshotResult> {
  let cursor: string | null = null;
  const byTarget = new Map<string, WeeklySnapshotInput>();

  for (;;) {
    const result: DailyRollupsPage = await ctx.runQuery(
      internal.downloadMetrics.listDailyRollupsForSnapshotInternal,
      {
        weekStart,
        paginationOpts: { cursor, numItems: pageSize },
      },
    );
    addDailyRollupsToWeeklySnapshots(byTarget, result.page);
    if (result.isDone) break;
    cursor = result.continueCursor;
  }

  const snapshots = [...byTarget.values()];
  for (let index = 0; index < snapshots.length; index += SNAPSHOT_WRITE_BATCH_SIZE) {
    const batch = snapshots.slice(index, index + SNAPSHOT_WRITE_BATCH_SIZE);
    await ctx.runMutation(internal.downloadMetrics.writeWeeklyTargetSnapshotsInternal, {
      weekStart,
      snapshots: batch,
    });
  }

  const totals = summarizeWeeklySnapshots(snapshots);
  await ctx.runMutation(internal.downloadMetrics.writeGlobalWeeklySnapshotInternal, {
    weekStart,
    downloads: totals.downloads,
    targetCount: snapshots.length,
  });

  return {
    weekStart,
    targetCount: snapshots.length,
    downloads: totals.downloads,
  };
}

async function hashDownloadIdentity(identityKind: DownloadIdentityKind, identityValue: string) {
  const secret = process.env[HMAC_SECRET_ENV]?.trim();
  if (!secret) {
    throw new Error(`${HMAC_SECRET_ENV} is required for download metering`);
  }
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${identityKind}:${identityValue}`),
  );
  return toHex(new Uint8Array(signature));
}

function aggregateWeeklySnapshots(rollups: DailyRollupForSnapshot[]): WeeklySnapshotInput[] {
  const byTarget = new Map<string, WeeklySnapshotInput>();
  addDailyRollupsToWeeklySnapshots(byTarget, rollups);
  return [...byTarget.values()];
}

function addDailyRollupsToWeeklySnapshots(
  byTarget: Map<string, WeeklySnapshotInput>,
  rollups: DailyRollupForSnapshot[],
) {
  for (const rollup of rollups) {
    const key = `${rollup.targetKind}:${rollup.targetId}`;
    const current = byTarget.get(key) ?? {
      targetKind: rollup.targetKind,
      targetId: rollup.targetId,
      downloads: 0,
    };
    current.downloads += rollup.downloads;
    byTarget.set(key, current);
  }
}

function summarizeWeeklySnapshots(snapshots: WeeklySnapshotInput[]) {
  return snapshots.reduce(
    (total, snapshot) => ({
      downloads: total.downloads + snapshot.downloads,
    }),
    { downloads: 0 },
  );
}

function getDayStart(timestamp: number) {
  return Math.floor(timestamp / DAY_MS) * DAY_MS;
}

function getWeekStart(timestamp: number) {
  return (
    Math.floor((timestamp - MONDAY_EPOCH_OFFSET_MS) / WEEK_MS) * WEEK_MS + MONDAY_EPOCH_OFFSET_MS
  );
}

function normalizeSnapshotPageSize(pageSize: number | undefined) {
  return Math.max(1, Math.min(pageSize ?? DEFAULT_SNAPSHOT_PAGE_SIZE, DEFAULT_SNAPSHOT_PAGE_SIZE));
}

function toHex(bytes: Uint8Array) {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export const __test = {
  aggregateWeeklySnapshots,
  getDayStart,
  getDownloadIdentity,
  getWeekStart,
  hashDownloadIdentity,
  snapshotDownloadMetricsForWeek,
};
