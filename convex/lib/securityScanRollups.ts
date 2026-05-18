import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export const SECURITY_SCAN_STATUSES = [
  "benign",
  "suspicious",
  "malicious",
  "pending",
  "unknown",
] as const;

export const SECURITY_SCAN_ENTITY_TYPES = ["skill", "plugin"] as const;

export type SecurityScanStatus = (typeof SECURITY_SCAN_STATUSES)[number];
export type SecurityScanEntityType = (typeof SECURITY_SCAN_ENTITY_TYPES)[number];

type SkillScanLike = {
  _id?: Id<"skills">;
  softDeletedAt?: number;
  moderationVerdict?: "clean" | "suspicious" | "malicious";
  moderationReason?: string;
  isSuspicious?: boolean;
};

type PackageScanLike = {
  _id?: Id<"packages">;
  softDeletedAt?: number;
  scanStatus?: "clean" | "suspicious" | "malicious" | "pending" | "not-run";
};

export function emptySecurityScanCounts(): Record<SecurityScanStatus, number> {
  return {
    benign: 0,
    suspicious: 0,
    malicious: 0,
    pending: 0,
    unknown: 0,
  };
}

export function securityScanStatusFromSkill(skill: SkillScanLike): SecurityScanStatus | null {
  if (skill.softDeletedAt !== undefined) return null;
  const reason = skill.moderationReason?.trim().toLowerCase();
  if (
    reason === "pending.scan" ||
    reason === "pending.scan.stale" ||
    reason?.endsWith(".pending")
  ) {
    return "pending";
  }
  if (skill.moderationVerdict === "clean") return "benign";
  if (skill.moderationVerdict === "suspicious") return "suspicious";
  if (skill.moderationVerdict === "malicious") return "malicious";
  if (skill.isSuspicious) return "suspicious";
  return "unknown";
}

export function securityScanStatusFromPackage(pkg: PackageScanLike): SecurityScanStatus | null {
  if (pkg.softDeletedAt !== undefined) return null;
  if (pkg.scanStatus === "clean") return "benign";
  if (pkg.scanStatus === "suspicious") return "suspicious";
  if (pkg.scanStatus === "malicious") return "malicious";
  if (pkg.scanStatus === "pending") return "pending";
  return "unknown";
}

export function getSecurityScanRollupDeltas(
  previousStatus: SecurityScanStatus | null | undefined,
  nextStatus: SecurityScanStatus | null | undefined,
) {
  if (previousStatus === nextStatus) return [];
  return [
    ...(previousStatus ? [{ status: previousStatus, delta: -1 }] : []),
    ...(nextStatus ? [{ status: nextStatus, delta: 1 }] : []),
  ];
}

export async function syncSecurityScanEntityState(
  ctx: Pick<MutationCtx, "db">,
  params: {
    entityType: SecurityScanEntityType;
    targetId: string;
    label: string;
    status: SecurityScanStatus | null;
    now?: number;
  },
) {
  const now = params.now ?? Date.now();
  let existing;
  try {
    existing = await ctx.db
      .query("securityScanEntityStates")
      .withIndex("by_entity_target", (q) =>
        q.eq("entityType", params.entityType).eq("targetId", params.targetId),
      )
      .unique();
  } catch (error) {
    if (isUnsupportedTestHarnessTableError(error)) {
      return { ok: true as const, skipped: "unsupported_test_harness" as const };
    }
    throw error;
  }
  const previousStatus = existing?.status ?? null;
  const deltas = getSecurityScanRollupDeltas(previousStatus, params.status);

  if (params.status) {
    const doc = {
      entityType: params.entityType,
      targetId: params.targetId,
      label: params.label,
      status: params.status,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, doc);
    } else {
      await ctx.db.insert("securityScanEntityStates", doc);
    }
  } else if (existing) {
    await ctx.db.delete(existing._id);
  }

  for (const { status, delta } of deltas) {
    const rollup = await ctx.db
      .query("securityScanRollups")
      .withIndex("by_entity_status", (q) =>
        q.eq("entityType", params.entityType).eq("status", status),
      )
      .unique();
    const nextCount = Math.max(0, (rollup?.count ?? 0) + delta);
    if (rollup) {
      await ctx.db.patch(rollup._id, { count: nextCount, updatedAt: now });
    } else {
      await ctx.db.insert("securityScanRollups", {
        entityType: params.entityType,
        status,
        count: nextCount,
        updatedAt: now,
      });
    }
  }
  return { ok: true as const };
}

function isUnsupportedTestHarnessTableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Unexpected table securityScan") ||
    message.includes("Unexpected table: securityScan") ||
    message.includes("unexpected table securityScan") ||
    message.includes("unexpected table: securityScan") ||
    message.includes("Unexpected query table: securityScan") ||
    message.includes("Cannot read properties of undefined")
  );
}
