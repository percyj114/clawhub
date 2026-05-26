import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import {
  buildPluginSecurityScanArtifactState,
  buildSkillSecurityScanArtifactState,
  clampSecurityScanDigestBackfillBatchSize,
  getCurrentRollupDeltas,
  toSecurityScanHourBucket,
  type SecurityScanArtifactStateFields,
  type SecurityScanCurrentRollupDimensions,
  type SecurityScanHourlyRollupDimensions,
} from "./lib/securityScanDigest";

const securityScanArtifactKindValidator = v.union(v.literal("skill"), v.literal("plugin"));
const securityScanDigestTargetKindValidator = v.union(
  v.literal("skillVersion"),
  v.literal("packageRelease"),
);
const clawScanDigestVerdictValidator = v.union(
  v.literal("pass"),
  v.literal("suspicious"),
  v.literal("malicious"),
  v.literal("pending"),
  v.literal("failed"),
  v.literal("unknown"),
);
const securityScanPipelineStatusValidator = v.union(
  v.literal("none"),
  v.literal("queued"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
);
const securityScanFailureStatusValidator = v.union(v.literal("none"), v.literal("failed"));
const securityScanJobSourceValidator = v.union(
  v.literal("publish"),
  v.literal("clawscan-note"),
  v.literal("vt-update"),
  v.literal("backfill"),
  v.literal("manual"),
);
const pluginPackageFamilyValidator = v.union(v.literal("code-plugin"), v.literal("bundle-plugin"));

const securityScanArtifactStateFieldsValidator = v.object({
  artifactKind: securityScanArtifactKindValidator,
  targetKind: securityScanDigestTargetKindValidator,
  artifactKey: v.string(),
  targetKey: v.string(),
  skillId: v.optional(v.id("skills")),
  skillVersionId: v.optional(v.id("skillVersions")),
  packageId: v.optional(v.id("packages")),
  packageReleaseId: v.optional(v.id("packageReleases")),
  ownerUserId: v.id("users"),
  ownerPublisherId: v.optional(v.id("publishers")),
  slug: v.optional(v.string()),
  name: v.optional(v.string()),
  displayName: v.string(),
  version: v.optional(v.string()),
  clawScanVerdict: clawScanDigestVerdictValidator,
  clawScanStatus: v.optional(v.string()),
  clawScanCheckedAt: v.optional(v.number()),
  clawScanSummary: v.optional(v.string()),
  clawScanModel: v.optional(v.string()),
  clawScanPrimaryRiskBucket: v.optional(v.string()),
  clawScanPrimaryCategoryKey: v.optional(v.string()),
  clawScanPrimaryCategoryLabel: v.optional(v.string()),
  clawScanVisibleFindingCount: v.optional(v.number()),
  clawScanHighestSeverity: v.optional(v.string()),
  scanJobStatus: securityScanPipelineStatusValidator,
  failureStatus: securityScanFailureStatusValidator,
  lastScanJobId: v.optional(v.id("securityScanJobs")),
  lastScanJobSource: v.optional(securityScanJobSourceValidator),
  lastScanWorkerId: v.optional(v.string()),
  lastScanAttempts: v.optional(v.number()),
  lastScanQueuedAt: v.optional(v.number()),
  lastScanStartedAt: v.optional(v.number()),
  lastScanCompletedAt: v.optional(v.number()),
  lastScanFailedAt: v.optional(v.number()),
  lastScanUpdatedAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
  skillSpectorStatus: v.optional(v.string()),
  skillSpectorScore: v.optional(v.number()),
  skillSpectorSeverity: v.optional(v.string()),
  skillSpectorRecommendation: v.optional(v.string()),
  skillSpectorIssueCount: v.optional(v.number()),
  skillSpectorTopCategory: v.optional(v.string()),
  skillSpectorCheckedAt: v.optional(v.number()),
  staticStatus: v.optional(v.string()),
  staticReasonCount: v.optional(v.number()),
  staticCheckedAt: v.optional(v.number()),
  vtStatus: v.optional(v.string()),
  vtVerdict: v.optional(v.string()),
  vtMalicious: v.optional(v.number()),
  vtSuspicious: v.optional(v.number()),
  vtCheckedAt: v.optional(v.number()),
  evidenceUpdatedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const hourlyRollupDimensionsValidator = v.object({
  artifactKind: securityScanArtifactKindValidator,
  clawScanVerdict: clawScanDigestVerdictValidator,
  scanJobStatus: securityScanPipelineStatusValidator,
  failureStatus: securityScanFailureStatusValidator,
});

type DigestMutationCtx = Pick<MutationCtx, "db">;

async function applyCurrentRollupDelta(
  ctx: DigestMutationCtx,
  dimensions: SecurityScanCurrentRollupDimensions,
  delta: 1 | -1,
  now: number,
) {
  const existing = await ctx.db
    .query("securityScanCurrentRollups")
    .withIndex("by_kind_rollup_category_verdict_job_failure", (q) =>
      q
        .eq("artifactKind", dimensions.artifactKind)
        .eq("rollupKind", dimensions.rollupKind)
        .eq("categoryKey", dimensions.categoryKey)
        .eq("clawScanVerdict", dimensions.clawScanVerdict)
        .eq("scanJobStatus", dimensions.scanJobStatus)
        .eq("failureStatus", dimensions.failureStatus),
    )
    .unique();
  const nextCount = (existing?.count ?? 0) + delta;
  if (existing) {
    if (nextCount <= 0) {
      await ctx.db.delete(existing._id);
      return;
    }
    await ctx.db.patch(existing._id, {
      categoryLabel: dimensions.categoryLabel,
      count: nextCount,
      updatedAt: now,
    });
    return;
  }
  if (nextCount <= 0) return;
  await ctx.db.insert("securityScanCurrentRollups", {
    ...dimensions,
    count: nextCount,
    updatedAt: now,
  });
}

export async function upsertSecurityScanArtifactState(
  ctx: DigestMutationCtx,
  fields: SecurityScanArtifactStateFields,
) {
  const existing = await ctx.db
    .query("securityScanArtifactStates")
    .withIndex("by_artifact_kind_and_artifact_key", (q) =>
      q.eq("artifactKind", fields.artifactKind).eq("artifactKey", fields.artifactKey),
    )
    .unique();
  const stateFields = existing ? { ...fields, createdAt: existing.createdAt } : fields;
  const rollupDeltas = getCurrentRollupDeltas(existing, stateFields);
  if (existing) {
    await ctx.db.patch(existing._id, stateFields);
  } else {
    await ctx.db.insert("securityScanArtifactStates", stateFields);
  }
  for (const rollupDelta of rollupDeltas) {
    await applyCurrentRollupDelta(ctx, rollupDelta.dimensions, rollupDelta.delta, fields.updatedAt);
  }
  return {
    inserted: !existing,
    rollupDeltaCount: rollupDeltas.length,
  };
}

export async function deleteSecurityScanArtifactState(
  ctx: DigestMutationCtx,
  existing: Doc<"securityScanArtifactStates">,
  now: number,
) {
  const rollupDeltas = getCurrentRollupDeltas(existing, null);
  await ctx.db.delete(existing._id);
  for (const rollupDelta of rollupDeltas) {
    await applyCurrentRollupDelta(ctx, rollupDelta.dimensions, rollupDelta.delta, now);
  }
  return { deleted: true, rollupDeltaCount: rollupDeltas.length };
}

export const upsertSecurityScanArtifactStateInternal = internalMutation({
  args: {
    state: securityScanArtifactStateFieldsValidator,
  },
  handler: async (ctx, args) => {
    return await upsertSecurityScanArtifactState(ctx, args.state);
  },
});

export const deleteSecurityScanArtifactStateInternal = internalMutation({
  args: {
    artifactKind: securityScanArtifactKindValidator,
    artifactKey: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("securityScanArtifactStates")
      .withIndex("by_artifact_kind_and_artifact_key", (q) =>
        q.eq("artifactKind", args.artifactKind).eq("artifactKey", args.artifactKey),
      )
      .unique();
    if (!existing) return { deleted: false, rollupDeltaCount: 0 };
    return await deleteSecurityScanArtifactState(ctx, existing, Date.now());
  },
});

async function getLatestSkillScanJob(ctx: DigestMutationCtx, skillVersionId: Id<"skillVersions">) {
  return await ctx.db
    .query("securityScanJobs")
    .withIndex("by_skill_version_and_updated_at", (q) => q.eq("skillVersionId", skillVersionId))
    .order("desc")
    .first();
}

async function getLatestPackageScanJob(
  ctx: DigestMutationCtx,
  packageReleaseId: Id<"packageReleases">,
) {
  return await ctx.db
    .query("securityScanJobs")
    .withIndex("by_package_release_and_updated_at", (q) =>
      q.eq("packageReleaseId", packageReleaseId),
    )
    .order("desc")
    .first();
}

async function writeBackfillMetadata(
  ctx: DigestMutationCtx,
  params: {
    key: string;
    artifactKind: "skill" | "plugin";
    cursor: string | null;
    isDone: boolean;
    scannedCount: number;
    upsertedCount: number;
    skippedCount: number;
    resetCounts: boolean;
    now: number;
  },
) {
  const existing = await ctx.db
    .query("securityScanDigestMetadata")
    .withIndex("by_key", (q) => q.eq("key", params.key))
    .unique();
  const previousCounts =
    existing && !params.resetCounts
      ? {
          scannedCount: existing.scannedCount,
          upsertedCount: existing.upsertedCount,
          skippedCount: existing.skippedCount,
        }
      : { scannedCount: 0, upsertedCount: 0, skippedCount: 0 };
  const fields: Omit<Doc<"securityScanDigestMetadata">, "_creationTime" | "_id"> = {
    key: params.key,
    artifactKind: params.artifactKind,
    cursor: params.cursor,
    isDone: params.isDone,
    scannedCount: previousCounts.scannedCount + params.scannedCount,
    upsertedCount: previousCounts.upsertedCount + params.upsertedCount,
    skippedCount: previousCounts.skippedCount + params.skippedCount,
    startedAt: params.resetCounts || !existing ? params.now : existing.startedAt,
    completedAt: params.isDone ? params.now : undefined,
    updatedAt: params.now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, fields);
  } else {
    await ctx.db.insert("securityScanDigestMetadata", fields);
  }
  return fields;
}

export const backfillSkillSecurityScanDigestPageInternal = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const page = await ctx.db
      .query("skills")
      .withIndex("by_active_updated", (q) => q.eq("softDeletedAt", undefined))
      .paginate({
        cursor: args.cursor ?? null,
        numItems: clampSecurityScanDigestBackfillBatchSize(args.batchSize),
      });
    let upsertedCount = 0;
    let skippedCount = 0;
    for (const skill of page.page) {
      if (!skill.latestVersionId) {
        skippedCount++;
        continue;
      }
      const version = await ctx.db.get(skill.latestVersionId);
      if (!version || version.softDeletedAt) {
        skippedCount++;
        continue;
      }
      const scanJob = await getLatestSkillScanJob(ctx, version._id);
      await upsertSecurityScanArtifactState(
        ctx,
        buildSkillSecurityScanArtifactState({ skill, version, scanJob, now }),
      );
      upsertedCount++;
    }
    const metadata = await writeBackfillMetadata(ctx, {
      key: "backfill:skill",
      artifactKind: "skill",
      cursor: page.continueCursor,
      isDone: page.isDone,
      scannedCount: page.page.length,
      upsertedCount,
      skippedCount,
      resetCounts: args.cursor === undefined || args.cursor === null,
      now,
    });
    return {
      scannedCount: page.page.length,
      upsertedCount,
      skippedCount,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
      metadata,
    };
  },
});

export const backfillPluginSecurityScanDigestPageInternal = internalMutation({
  args: {
    family: pluginPackageFamilyValidator,
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const page = await ctx.db
      .query("packages")
      .withIndex("by_family_and_soft_deleted_at_and_updated_at", (q) =>
        q.eq("family", args.family).eq("softDeletedAt", undefined),
      )
      .paginate({
        cursor: args.cursor ?? null,
        numItems: clampSecurityScanDigestBackfillBatchSize(args.batchSize),
      });
    let upsertedCount = 0;
    let skippedCount = 0;
    for (const pkg of page.page) {
      if (!pkg.latestReleaseId) {
        skippedCount++;
        continue;
      }
      const release = await ctx.db.get(pkg.latestReleaseId);
      if (!release || release.softDeletedAt) {
        skippedCount++;
        continue;
      }
      const scanJob = await getLatestPackageScanJob(ctx, release._id);
      await upsertSecurityScanArtifactState(
        ctx,
        buildPluginSecurityScanArtifactState({ pkg, release, scanJob, now }),
      );
      upsertedCount++;
    }
    const metadata = await writeBackfillMetadata(ctx, {
      key: `backfill:plugin:${args.family}`,
      artifactKind: "plugin",
      cursor: page.continueCursor,
      isDone: page.isDone,
      scannedCount: page.page.length,
      upsertedCount,
      skippedCount,
      resetCounts: args.cursor === undefined || args.cursor === null,
      now,
    });
    return {
      family: args.family,
      scannedCount: page.page.length,
      upsertedCount,
      skippedCount,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
      metadata,
    };
  },
});

function isStaleSkillState(skill: Doc<"skills"> | null, state: Doc<"securityScanArtifactStates">) {
  return (
    !skill ||
    skill.softDeletedAt !== undefined ||
    !state.skillVersionId ||
    skill.latestVersionId !== state.skillVersionId
  );
}

function isStalePluginState(pkg: Doc<"packages"> | null, state: Doc<"securityScanArtifactStates">) {
  return (
    !pkg ||
    pkg.softDeletedAt !== undefined ||
    !state.packageReleaseId ||
    pkg.latestReleaseId !== state.packageReleaseId
  );
}

export const pruneStaleSecurityScanArtifactStatesPageInternal = internalMutation({
  args: {
    artifactKind: securityScanArtifactKindValidator,
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const page = await ctx.db
      .query("securityScanArtifactStates")
      .withIndex("by_artifact_kind_and_updated_at", (q) => q.eq("artifactKind", args.artifactKind))
      .paginate({
        cursor: args.cursor ?? null,
        numItems: clampSecurityScanDigestBackfillBatchSize(args.batchSize),
      });
    let deletedCount = 0;
    for (const state of page.page) {
      if (state.artifactKind === "skill") {
        const skill = state.skillId ? await ctx.db.get(state.skillId) : null;
        if (!isStaleSkillState(skill, state)) continue;
      } else {
        const pkg = state.packageId ? await ctx.db.get(state.packageId) : null;
        if (!isStalePluginState(pkg, state)) continue;
      }
      await deleteSecurityScanArtifactState(ctx, state, now);
      deletedCount++;
    }
    return {
      scannedCount: page.page.length,
      deletedCount,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const clearSecurityScanCurrentRollupsPageInternal = internalMutation({
  args: {
    artifactKind: securityScanArtifactKindValidator,
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await clearSecurityScanCurrentRollupsPage(ctx, args);
  },
});

export async function clearSecurityScanCurrentRollupsPage(
  ctx: DigestMutationCtx,
  args: {
    artifactKind: "skill" | "plugin";
    batchSize?: number;
  },
) {
  const batchSize = clampSecurityScanDigestBackfillBatchSize(args.batchSize);
  const rows = await ctx.db
    .query("securityScanCurrentRollups")
    .withIndex("by_artifact_kind_and_rollup_kind_and_category_key", (q) =>
      q.eq("artifactKind", args.artifactKind),
    )
    .take(batchSize);
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
  return {
    deletedCount: rows.length,
    isDone: rows.length < batchSize,
  };
}

export const rebuildSecurityScanCurrentRollupsFromStatesPageInternal = internalMutation({
  args: {
    artifactKind: securityScanArtifactKindValidator,
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await rebuildSecurityScanCurrentRollupsFromStatesPage(ctx, args);
  },
});

export async function rebuildSecurityScanCurrentRollupsFromStatesPage(
  ctx: DigestMutationCtx,
  args: {
    artifactKind: "skill" | "plugin";
    cursor?: string | null;
    batchSize?: number;
  },
) {
  const now = Date.now();
  const page = await ctx.db
    .query("securityScanArtifactStates")
    .withIndex("by_artifact_kind_and_updated_at", (q) => q.eq("artifactKind", args.artifactKind))
    .paginate({
      cursor: args.cursor ?? null,
      numItems: clampSecurityScanDigestBackfillBatchSize(args.batchSize),
    });
  let rollupDeltaCount = 0;
  for (const state of page.page) {
    const rollupDeltas = getCurrentRollupDeltas(null, state);
    for (const rollupDelta of rollupDeltas) {
      await applyCurrentRollupDelta(ctx, rollupDelta.dimensions, rollupDelta.delta, now);
      rollupDeltaCount++;
    }
  }
  return {
    scannedCount: page.page.length,
    rollupDeltaCount,
    continueCursor: page.continueCursor,
    isDone: page.isDone,
  };
}

async function applyHourlyRollupDelta(
  ctx: DigestMutationCtx,
  bucketStartMs: number,
  dimensions: SecurityScanHourlyRollupDimensions,
  count: number,
  now: number,
) {
  const existing = await ctx.db
    .query("securityScanHourlyRollups")
    .withIndex("by_bucket_kind_verdict_job_failure", (q) =>
      q
        .eq("bucketStartMs", bucketStartMs)
        .eq("artifactKind", dimensions.artifactKind)
        .eq("clawScanVerdict", dimensions.clawScanVerdict)
        .eq("scanJobStatus", dimensions.scanJobStatus)
        .eq("failureStatus", dimensions.failureStatus),
    )
    .unique();
  if (existing) {
    const nextCount = existing.count + count;
    await ctx.db.patch(existing._id, { count: nextCount, updatedAt: now });
    return { updated: true, count: nextCount };
  }
  await ctx.db.insert("securityScanHourlyRollups", {
    bucketStartMs,
    ...dimensions,
    count,
    updatedAt: now,
  });
  return { updated: true, count };
}

export async function recordSecurityScanHourlyRollupEvent(
  ctx: DigestMutationCtx,
  params: {
    eventKey: string;
    occurredAt: number;
    dimensions: SecurityScanHourlyRollupDimensions;
    count?: number;
  },
) {
  const count = params.count ?? 1;
  if (count <= 0) return { updated: false, duplicate: false, count: 0 };
  const existingEvent = await ctx.db
    .query("securityScanHourlyRollupEvents")
    .withIndex("by_event_key", (q) => q.eq("eventKey", params.eventKey))
    .unique();
  if (existingEvent) return { updated: false, duplicate: true, count: existingEvent.count };

  const now = Date.now();
  const bucketStartMs = toSecurityScanHourBucket(params.occurredAt);
  await ctx.db.insert("securityScanHourlyRollupEvents", {
    eventKey: params.eventKey,
    bucketStartMs,
    ...params.dimensions,
    count,
    createdAt: now,
  });
  const result = await applyHourlyRollupDelta(ctx, bucketStartMs, params.dimensions, count, now);
  return { ...result, duplicate: false };
}

export const recordSecurityScanHourlyRollupEventInternal = internalMutation({
  args: {
    eventKey: v.string(),
    occurredAt: v.number(),
    dimensions: hourlyRollupDimensionsValidator,
    count: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await recordSecurityScanHourlyRollupEvent(ctx, args);
  },
});
