import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./functions";
import { assertModerator, requireUser, requireUserFromAction } from "./lib/access";
import { normalizePackageName } from "./lib/packageRegistry";
import {
  emptySecurityScanCounts,
  securityScanStatusFromPackage,
  securityScanStatusFromSkill,
  syncSecurityScanEntityState,
  type SecurityScanEntityType,
  type SecurityScanStatus,
} from "./lib/securityScanRollups";

const RESCAN_REQUEST_TTL_MS = 10 * 60 * 1000;
const SECURITY_SCAN_ROLLUP_REBUILD_KEY = "security-scan-rollups-v1";

const securityScanStatusValidator = v.union(
  v.literal("benign"),
  v.literal("suspicious"),
  v.literal("malicious"),
  v.literal("pending"),
  v.literal("unknown"),
);

const securityScanEntityTypeValidator = v.union(v.literal("skill"), v.literal("plugin"));

type SecurityScanCounts = Record<SecurityScanStatus, number>;

function buildEmptyTotals(): Record<SecurityScanEntityType, SecurityScanCounts> {
  return {
    skill: emptySecurityScanCounts(),
    plugin: emptySecurityScanCounts(),
  };
}

async function requireModeratorById(ctx: Pick<QueryCtx, "db">, actorUserId: Id<"users">) {
  const actor = await ctx.db.get(actorUserId);
  if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
  assertModerator(actor);
  return actor;
}

async function readSecurityScanSummary(ctx: Pick<QueryCtx, "db">) {
  const totals = buildEmptyTotals();
  const rollups = await ctx.db.query("securityScanRollups").collect();
  const rebuildMetadata = await ctx.db
    .query("securityScanRollupMetadata")
    .withIndex("by_key", (q) => q.eq("key", SECURITY_SCAN_ROLLUP_REBUILD_KEY))
    .unique();
  let updatedAt = 0;
  for (const rollup of rollups) {
    totals[rollup.entityType][rollup.status] = rollup.count;
    updatedAt = Math.max(updatedAt, rollup.updatedAt);
  }
  return {
    generatedAt: Date.now(),
    totals: {
      skills: totals.skill,
      plugins: totals.plugin,
    },
    stale: !rebuildMetadata,
    updatedAt: updatedAt || null,
  };
}

async function findSkillBySlug(ctx: Pick<QueryCtx, "db">, slug: string) {
  return await ctx.db
    .query("skills")
    .withIndex("by_slug", (q) => q.eq("slug", slug.trim().toLowerCase()))
    .unique();
}

async function findPackageByName(ctx: Pick<QueryCtx, "db">, name: string) {
  const normalizedName = normalizePackageName(name);
  return await ctx.db
    .query("packages")
    .withIndex("by_name", (q) => q.eq("normalizedName", normalizedName))
    .unique();
}

async function findPackageRelease(
  ctx: Pick<QueryCtx, "db">,
  pkg: Doc<"packages">,
  version?: string,
) {
  if (version?.trim()) {
    return await ctx.db
      .query("packageReleases")
      .withIndex("by_package_version", (q) =>
        q.eq("packageId", pkg._id).eq("version", version.trim()),
      )
      .unique();
  }
  return pkg.latestReleaseId ? await ctx.db.get(pkg.latestReleaseId) : null;
}

async function findActiveQueuedRequest(
  ctx: Pick<MutationCtx, "db">,
  params: { entityType: SecurityScanEntityType; targetId: string; now: number },
) {
  return await ctx.db
    .query("securityScanRequests")
    .withIndex("by_entity_target_status_expires", (q) =>
      q
        .eq("entityType", params.entityType)
        .eq("targetId", params.targetId)
        .eq("status", "queued")
        .gt("expiresAt", params.now),
    )
    .first();
}

async function recordSecurityRescanRequest(
  ctx: MutationCtx,
  params: {
    actorUserId: Id<"users">;
    entityType: SecurityScanEntityType;
    targetId: string;
    targetLabel: string;
    version?: string;
    scanners: string[];
    now: number;
  },
) {
  const existing = await findActiveQueuedRequest(ctx, params);
  if (existing) {
    return { existing, inserted: false as const };
  }
  const requestId = await ctx.db.insert("securityScanRequests", {
    entityType: params.entityType,
    targetId: params.targetId,
    targetLabel: params.targetLabel,
    version: params.version,
    status: "queued",
    scanners: params.scanners,
    requestedByUserId: params.actorUserId,
    createdAt: params.now,
    expiresAt: params.now + RESCAN_REQUEST_TTL_MS,
  });
  const inserted = await ctx.db.get(requestId);
  if (!inserted) throw new ConvexError("Failed to record security rescan request");
  return { existing: inserted, inserted: true as const };
}

async function requestSkillRescan(ctx: MutationCtx, actorUserId: Id<"users">, slug: string) {
  const actor = await requireModeratorById(ctx, actorUserId);
  const skill = await findSkillBySlug(ctx, slug);
  if (!skill || skill.softDeletedAt || !skill.latestVersionId) {
    return {
      ok: false as const,
      state: "target_not_found" as const,
      entityType: "skill" as const,
      target: slug,
      scheduledScanners: [],
    };
  }
  const version = await ctx.db.get(skill.latestVersionId);
  if (!version || version.softDeletedAt) {
    return {
      ok: false as const,
      state: "target_not_found" as const,
      entityType: "skill" as const,
      target: skill.slug,
      scheduledScanners: [],
    };
  }

  const scanners = ["static", "clawscan", "virustotal"];
  const now = Date.now();
  const request = await recordSecurityRescanRequest(ctx, {
    actorUserId,
    entityType: "skill",
    targetId: String(version._id),
    targetLabel: skill.slug,
    version: version.version,
    scanners,
    now,
  });
  if (!request.inserted) {
    return {
      ok: true as const,
      state: "already_in_progress" as const,
      entityType: "skill" as const,
      target: skill.slug,
      version: version.version,
      scheduledScanners: [],
    };
  }

  await ctx.scheduler.runAfter(0, internal.skills.scanSkillVersionStaticallyInternal, {
    skillId: skill._id,
    versionId: version._id,
  });
  await ctx.scheduler.runAfter(0, internal.securityScan.enqueueSkillVersionScanInternal, {
    versionId: version._id,
    source: "manual",
    waitForVtMs: 0,
  });
  await ctx.scheduler.runAfter(0, internal.vt.scanWithVirusTotal, { versionId: version._id });
  await ctx.db.insert("auditLogs", {
    actorUserId: actor._id,
    action: "security.skill.rescan",
    targetType: "skillVersion",
    targetId: version._id,
    metadata: {
      skillId: skill._id,
      slug: skill.slug,
      version: version.version,
      scanners,
    },
    createdAt: now,
  });

  return {
    ok: true as const,
    state: "queued" as const,
    entityType: "skill" as const,
    target: skill.slug,
    version: version.version,
    scheduledScanners: scanners,
  };
}

async function requestPluginRescan(
  ctx: MutationCtx,
  actorUserId: Id<"users">,
  name: string,
  version?: string,
) {
  const actor = await requireModeratorById(ctx, actorUserId);
  const pkg = await findPackageByName(ctx, name);
  if (!pkg || pkg.softDeletedAt || pkg.family === "skill") {
    return {
      ok: false as const,
      state: "target_not_found" as const,
      entityType: "plugin" as const,
      target: name,
      scheduledScanners: [],
    };
  }
  const release = await findPackageRelease(ctx, pkg, version);
  if (!release || release.softDeletedAt) {
    return {
      ok: false as const,
      state: "target_not_found" as const,
      entityType: "plugin" as const,
      target: pkg.name,
      scheduledScanners: [],
    };
  }

  const scanners = ["static", "clawscan", "virustotal"];
  const now = Date.now();
  const request = await recordSecurityRescanRequest(ctx, {
    actorUserId,
    entityType: "plugin",
    targetId: String(release._id),
    targetLabel: pkg.name,
    version: release.version,
    scanners,
    now,
  });
  if (!request.inserted) {
    return {
      ok: true as const,
      state: "already_in_progress" as const,
      entityType: "plugin" as const,
      target: pkg.name,
      version: release.version,
      scheduledScanners: [],
    };
  }

  await ctx.scheduler.runAfter(0, internal.packages.scanPackageReleaseStaticallyInternal, {
    releaseId: release._id,
  });
  await ctx.scheduler.runAfter(0, internal.securityScan.enqueuePackageReleaseScanInternal, {
    releaseId: release._id,
    source: "manual",
    waitForVtMs: 0,
  });
  await ctx.scheduler.runAfter(0, internal.vt.scanPackageReleaseWithVirusTotal, {
    releaseId: release._id,
  });
  await ctx.db.insert("auditLogs", {
    actorUserId: actor._id,
    action: "security.plugin.rescan",
    targetType: "packageRelease",
    targetId: release._id,
    metadata: {
      packageId: pkg._id,
      name: pkg.name,
      version: release.version,
      scanners,
    },
    createdAt: now,
  });

  return {
    ok: true as const,
    state: "queued" as const,
    entityType: "plugin" as const,
    target: pkg.name,
    version: release.version,
    scheduledScanners: scanners,
  };
}

export const getSecurityScanSummaryForStaff = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireUser(ctx);
    assertModerator(user);
    return await readSecurityScanSummary(ctx);
  },
});

export const getSecurityScanSummaryForStaffInternal = internalQuery({
  args: { actorUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireModeratorById(ctx, args.actorUserId);
    return await readSecurityScanSummary(ctx);
  },
});

export const listSecurityScanItemsForStaff = query({
  args: {
    entityType: securityScanEntityTypeValidator,
    status: securityScanStatusValidator,
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertModerator(user);
    const page = await ctx.db
      .query("securityScanEntityStates")
      .withIndex("by_entity_status_updated", (q) =>
        q.eq("entityType", args.entityType).eq("status", args.status),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: page.page.map((item) => ({
        entityType: item.entityType,
        targetId: item.targetId,
        label: item.label,
        status: item.status,
        updatedAt: item.updatedAt,
      })),
    };
  },
});

export const requestSkillSecurityRescanForStaff = mutation({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    return await requestSkillRescan(ctx, userId, args.slug);
  },
});

export const requestPluginSecurityRescanForStaff = mutation({
  args: { name: v.string(), version: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    return await requestPluginRescan(ctx, userId, args.name, args.version);
  },
});

export const requestSkillSecurityRescanForStaffInternal = internalMutation({
  args: { actorUserId: v.id("users"), slug: v.string() },
  handler: async (ctx, args) => {
    return await requestSkillRescan(ctx, args.actorUserId, args.slug);
  },
});

export const requestPluginSecurityRescanForStaffInternal = internalMutation({
  args: { actorUserId: v.id("users"), name: v.string(), version: v.optional(v.string()) },
  handler: async (ctx, args) => {
    return await requestPluginRescan(ctx, args.actorUserId, args.name, args.version);
  },
});

export const refreshSkillSecurityScanStateInternal = internalMutation({
  args: { skillId: v.id("skills") },
  handler: async (ctx, args) => {
    const skill = await ctx.db.get(args.skillId);
    if (!skill) return { ok: true as const, skipped: "missing" as const };
    await syncSecurityScanEntityState(ctx, {
      entityType: "skill",
      targetId: String(skill._id),
      label: skill.slug,
      status: securityScanStatusFromSkill(skill),
    });
    return { ok: true as const };
  },
});

export const refreshPackageSecurityScanStateInternal = internalMutation({
  args: { packageId: v.id("packages") },
  handler: async (ctx, args) => {
    const pkg = await ctx.db.get(args.packageId);
    if (!pkg) return { ok: true as const, skipped: "missing" as const };
    await syncSecurityScanEntityState(ctx, {
      entityType: "plugin",
      targetId: String(pkg._id),
      label: pkg.name,
      status:
        pkg.family === "skill"
          ? null
          : securityScanStatusFromPackage({
              softDeletedAt: pkg.softDeletedAt,
              scanStatus: pkg.scanStatus,
            }),
    });
    return { ok: true as const };
  },
});

type SecurityScanRebuildPage<T extends "skills" | "packages"> = {
  ids: Id<T>[];
  continueCursor: string;
  isDone: boolean;
};

export const rebuildSecurityScanRollupsInternal: ReturnType<typeof internalAction> = internalAction(
  {
    args: {
      skillCursor: v.optional(v.union(v.string(), v.null())),
      packageCursor: v.optional(v.union(v.string(), v.null())),
      batchSize: v.optional(v.number()),
      synced: v.optional(v.number()),
    },
    handler: async (ctx, args): Promise<{ ok: true; synced: number; done: boolean }> => {
      const batchSize = Math.max(1, Math.min(Math.floor(args.batchSize ?? 100), 200));
      let synced = args.synced ?? 0;
      const skills = (await ctx.runQuery(internal.securityScans.getSecurityScanSkillRebuildPage, {
        cursor: args.skillCursor ?? null,
        batchSize,
      })) as SecurityScanRebuildPage<"skills">;
      for (const skillId of skills.ids) {
        await ctx.runMutation(internal.securityScans.refreshSkillSecurityScanStateInternal, {
          skillId,
        });
        synced += 1;
      }
      const packages = (await ctx.runQuery(
        internal.securityScans.getSecurityScanPackageRebuildPage,
        {
          cursor: args.packageCursor ?? null,
          batchSize,
        },
      )) as SecurityScanRebuildPage<"packages">;
      for (const packageId of packages.ids) {
        await ctx.runMutation(internal.securityScans.refreshPackageSecurityScanStateInternal, {
          packageId,
        });
        synced += 1;
      }
      if (!skills.isDone || !packages.isDone) {
        await ctx.scheduler.runAfter(0, internal.securityScans.rebuildSecurityScanRollupsInternal, {
          skillCursor: skills.isDone ? skills.continueCursor : skills.continueCursor,
          packageCursor: packages.isDone ? packages.continueCursor : packages.continueCursor,
          batchSize,
          synced,
        });
      }
      const done = skills.isDone && packages.isDone;
      if (done) {
        await ctx.runMutation(
          internal.securityScans.markSecurityScanRollupRebuildCompleteInternal,
          {
            completedAt: Date.now(),
          },
        );
      }
      return { ok: true as const, synced, done };
    },
  },
);

export const markSecurityScanRollupRebuildCompleteInternal = internalMutation({
  args: { completedAt: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("securityScanRollupMetadata")
      .withIndex("by_key", (q) => q.eq("key", SECURITY_SCAN_ROLLUP_REBUILD_KEY))
      .unique();
    const doc = {
      key: SECURITY_SCAN_ROLLUP_REBUILD_KEY,
      completedAt: args.completedAt,
      updatedAt: args.completedAt,
    };
    if (existing) {
      await ctx.db.patch(existing._id, doc);
      return existing._id;
    }
    return await ctx.db.insert("securityScanRollupMetadata", doc);
  },
});

export const rebuildSecurityScanRollupsForStaff: ReturnType<typeof action> = action({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ ok: true; synced: number; done: boolean }> => {
    const { user } = await requireUserFromAction(ctx);
    assertModerator(user);
    return await ctx.runAction(internal.securityScans.rebuildSecurityScanRollupsInternal, {
      batchSize: args.batchSize,
    });
  },
});

export const getSecurityScanSkillRebuildPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), batchSize: v.number() },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("skills").paginate({
      cursor: args.cursor,
      numItems: args.batchSize,
    });
    return {
      ids: page.page.map((skill) => skill._id),
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const getSecurityScanPackageRebuildPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), batchSize: v.number() },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("packages").paginate({
      cursor: args.cursor,
      numItems: args.batchSize,
    });
    return {
      ids: page.page.map((pkg) => pkg._id),
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});
