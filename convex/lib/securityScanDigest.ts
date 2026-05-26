import type { Doc } from "../_generated/dataModel";

export const SECURITY_SCAN_ARTIFACT_KINDS = ["skill", "plugin"] as const;
export type SecurityScanArtifactKind = (typeof SECURITY_SCAN_ARTIFACT_KINDS)[number];

export const CLAW_SCAN_DIGEST_VERDICTS = [
  "pass",
  "suspicious",
  "malicious",
  "pending",
  "failed",
  "unknown",
] as const;
export type ClawScanDigestVerdict = (typeof CLAW_SCAN_DIGEST_VERDICTS)[number];

export const SECURITY_SCAN_PIPELINE_STATUSES = [
  "none",
  "queued",
  "running",
  "succeeded",
  "failed",
] as const;
export type SecurityScanPipelineStatus = (typeof SECURITY_SCAN_PIPELINE_STATUSES)[number];

export const SECURITY_SCAN_FAILURE_STATUSES = ["none", "failed"] as const;
export type SecurityScanFailureStatus = (typeof SECURITY_SCAN_FAILURE_STATUSES)[number];

export const SECURITY_SCAN_ROLLUP_KINDS = [
  "all",
  "clawscanRiskBucket",
  "clawscanCategory",
] as const;
export type SecurityScanRollupKind = (typeof SECURITY_SCAN_ROLLUP_KINDS)[number];

export type SecurityScanArtifactStateFields = Omit<
  Doc<"securityScanArtifactStates">,
  "_creationTime" | "_id"
>;

export type SecurityScanCurrentRollupDimensions = Pick<
  Doc<"securityScanCurrentRollups">,
  | "artifactKind"
  | "rollupKind"
  | "categoryKey"
  | "clawScanVerdict"
  | "scanJobStatus"
  | "failureStatus"
> & {
  categoryLabel?: string;
};

export type SecurityScanHourlyRollupDimensions = Pick<
  Doc<"securityScanHourlyRollups">,
  "artifactKind" | "clawScanVerdict" | "scanJobStatus" | "failureStatus"
>;

export type SecurityScanRollupDelta = {
  dimensions: SecurityScanCurrentRollupDimensions;
  delta: 1 | -1;
};

type LlmAnalysisLike = NonNullable<Doc<"skillVersions">["llmAnalysis"]>;
type SkillSpectorAnalysisLike = NonNullable<Doc<"skillVersions">["skillSpectorAnalysis"]>;
type StaticScanLike = NonNullable<Doc<"skillVersions">["staticScan"]>;
type VirusTotalAnalysisLike = NonNullable<Doc<"skillVersions">["vtAnalysis"]>;
type SecurityScanJobLike = Pick<
  Doc<"securityScanJobs">,
  | "_id"
  | "status"
  | "source"
  | "workerId"
  | "attempts"
  | "createdAt"
  | "updatedAt"
  | "completedAt"
  | "lastError"
>;

type SkillDigestInput = Pick<
  Doc<"skills">,
  "_id" | "slug" | "displayName" | "ownerUserId" | "ownerPublisherId"
>;

type SkillVersionDigestInput = Pick<
  Doc<"skillVersions">,
  | "_id"
  | "version"
  | "vtAnalysis"
  | "skillSpectorAnalysis"
  | "llmAnalysis"
  | "staticScan"
  | "createdAt"
>;

type PackageDigestInput = Pick<
  Doc<"packages">,
  "_id" | "name" | "displayName" | "ownerUserId" | "ownerPublisherId"
>;

type PackageReleaseDigestInput = Pick<
  Doc<"packageReleases">,
  | "_id"
  | "version"
  | "vtAnalysis"
  | "skillSpectorAnalysis"
  | "llmAnalysis"
  | "staticScan"
  | "createdAt"
>;

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_BACKFILL_BATCH_SIZE = 50;
const MAX_BACKFILL_BATCH_SIZE = 250;
const MAX_DIGEST_TEXT_LENGTH = 2_000;

const RISK_BUCKET_LABELS: Record<string, string> = {
  abnormal_behavior_control: "Abnormal behavior control",
  permission_boundary: "Permission boundary",
  sensitive_data_protection: "Sensitive data protection",
};

function normalizeToken(value: string | null | undefined) {
  return value?.trim().toLowerCase();
}

function limitDigestText(value: string | null | undefined, maxLength = MAX_DIGEST_TEXT_LENGTH) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function severityRank(severity: string | null | undefined) {
  switch (normalizeToken(severity)) {
    case "critical":
      return 5;
    case "high":
      return 4;
    case "medium":
      return 3;
    case "low":
      return 2;
    case "info":
      return 1;
    default:
      return 0;
  }
}

function confidenceRank(confidence: string | null | undefined) {
  switch (normalizeToken(confidence)) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function isLowConfidence(value: unknown) {
  return typeof value === "string" && value.trim().toLowerCase() === "low";
}

function getVisibleAgenticRiskFindings(analysis: LlmAnalysisLike | null | undefined) {
  return (analysis?.agenticRiskFindings ?? []).filter(
    (finding) =>
      (finding.status === "note" || finding.status === "concern") &&
      Boolean(finding.evidence) &&
      !isLowConfidence(finding.confidence),
  );
}

function getHighestVisibleSeverity(analysis: LlmAnalysisLike | null | undefined) {
  let best: string | undefined;
  let bestRank = 0;
  for (const finding of getVisibleAgenticRiskFindings(analysis)) {
    const rank = severityRank(finding.severity);
    if (rank > bestRank) {
      best = finding.severity;
      bestRank = rank;
    }
  }
  return best;
}

function getPrimaryClawScanFinding(analysis: LlmAnalysisLike | null | undefined) {
  let best: NonNullable<LlmAnalysisLike["agenticRiskFindings"]>[number] | undefined;
  for (const finding of getVisibleAgenticRiskFindings(analysis)) {
    if (!best) {
      best = finding;
      continue;
    }
    const severityDiff = severityRank(finding.severity) - severityRank(best.severity);
    if (severityDiff > 0) {
      best = finding;
      continue;
    }
    if (severityDiff < 0) continue;

    const statusDiff = (finding.status === "concern" ? 1 : 0) - (best.status === "concern" ? 1 : 0);
    if (statusDiff > 0) {
      best = finding;
      continue;
    }
    if (statusDiff < 0) continue;

    const confidenceDiff = confidenceRank(finding.confidence) - confidenceRank(best.confidence);
    if (confidenceDiff > 0) best = finding;
  }
  return best;
}

function normalizeClawScanVerdictToken(
  value: string | null | undefined,
): ClawScanDigestVerdict | null {
  switch (normalizeToken(value)) {
    case "malicious":
      return "malicious";
    case "review":
    case "suspicious":
    case "warn":
    case "warning":
      return "suspicious";
    case "benign":
    case "clean":
    case "cleared":
    case "pass":
    case "undetected-only-fallback":
      return "pass";
    case "pending":
    case "loading":
    case "not_found":
    case "queued":
    case "running":
      return "pending";
    case "error":
    case "failed":
      return "failed";
    case "unknown":
      return "unknown";
    default:
      return null;
  }
}

export function clawScanVerdictFromLlmAnalysis(
  analysis: LlmAnalysisLike | null | undefined,
): ClawScanDigestVerdict {
  const verdict = normalizeClawScanVerdictToken(analysis?.verdict);
  const status = normalizeClawScanVerdictToken(analysis?.status);
  const normalized = verdict ?? status;
  if (!normalized) return analysis ? "unknown" : "pending";
  if (
    normalized === "pass" &&
    severityRank(getHighestVisibleSeverity(analysis)) >= severityRank("medium")
  ) {
    return "suspicious";
  }
  return normalized;
}

export function pipelineStatusFromJob(
  job: Pick<SecurityScanJobLike, "status"> | null | undefined,
): SecurityScanPipelineStatus {
  if (!job) return "none";
  return job.status;
}

export function failureStatusFromJob(
  job: Pick<SecurityScanJobLike, "status"> | null | undefined,
): SecurityScanFailureStatus {
  return job?.status === "failed" ? "failed" : "none";
}

export function clawScanVerdictForState(params: {
  llmAnalysis?: LlmAnalysisLike | null;
  scanJobStatus?: SecurityScanPipelineStatus;
}): ClawScanDigestVerdict {
  const fromAnalysis = clawScanVerdictFromLlmAnalysis(params.llmAnalysis);
  if (fromAnalysis !== "pending" || params.llmAnalysis) return fromAnalysis;
  if (params.scanJobStatus === "queued" || params.scanJobStatus === "running") return "pending";
  if (params.scanJobStatus === "failed") return "failed";
  return "unknown";
}

export function toSecurityScanHourBucket(timestamp: number) {
  return Math.floor(timestamp / HOUR_MS) * HOUR_MS;
}

export function clampSecurityScanDigestBackfillBatchSize(batchSize: number | null | undefined) {
  if (!Number.isFinite(batchSize ?? NaN)) return DEFAULT_BACKFILL_BATCH_SIZE;
  return Math.max(1, Math.min(MAX_BACKFILL_BATCH_SIZE, Math.floor(batchSize!)));
}

function getSkillSpectorTopCategory(analysis: SkillSpectorAnalysisLike | null | undefined) {
  let best: NonNullable<SkillSpectorAnalysisLike["issues"]>[number] | undefined;
  for (const issue of analysis?.issues ?? []) {
    if (!issue.category) continue;
    if (!best || severityRank(issue.severity) > severityRank(best.severity)) best = issue;
  }
  return best?.category;
}

function getVtEngineStats(analysis: VirusTotalAnalysisLike | null | undefined) {
  return analysis?.engineStats;
}

function getEvidenceUpdatedAt(params: {
  llmAnalysis?: LlmAnalysisLike | null;
  skillSpectorAnalysis?: SkillSpectorAnalysisLike | null;
  staticScan?: StaticScanLike | null;
  vtAnalysis?: VirusTotalAnalysisLike | null;
}) {
  const timestamps = [
    params.llmAnalysis?.checkedAt,
    params.skillSpectorAnalysis?.checkedAt,
    params.staticScan?.checkedAt,
    params.vtAnalysis?.checkedAt,
  ].filter((value): value is number => typeof value === "number");
  return timestamps.length > 0 ? Math.max(...timestamps) : undefined;
}

function getJobTiming(job: SecurityScanJobLike | null | undefined) {
  return {
    lastScanJobId: job?._id,
    lastScanJobSource: job?.source,
    lastScanWorkerId: job?.workerId,
    lastScanAttempts: job?.attempts,
    lastScanQueuedAt: job?.createdAt,
    lastScanStartedAt: job?.status === "running" ? job.updatedAt : undefined,
    lastScanCompletedAt:
      job?.status === "succeeded" ? (job.completedAt ?? job.updatedAt) : undefined,
    lastScanFailedAt: job?.status === "failed" ? job.updatedAt : undefined,
    lastScanUpdatedAt: job?.updatedAt,
    lastError: limitDigestText(job?.lastError),
  };
}

function buildSharedScanFields(params: {
  llmAnalysis?: LlmAnalysisLike | null;
  skillSpectorAnalysis?: SkillSpectorAnalysisLike | null;
  staticScan?: StaticScanLike | null;
  vtAnalysis?: VirusTotalAnalysisLike | null;
  scanJob?: SecurityScanJobLike | null;
}) {
  const scanJobStatus = pipelineStatusFromJob(params.scanJob);
  const failureStatus = failureStatusFromJob(params.scanJob);
  const primaryFinding = getPrimaryClawScanFinding(params.llmAnalysis);
  const vtStats = getVtEngineStats(params.vtAnalysis);
  const clawScanVerdict = clawScanVerdictForState({
    llmAnalysis: params.llmAnalysis,
    scanJobStatus,
  });
  return {
    clawScanVerdict,
    clawScanStatus: params.llmAnalysis?.status,
    clawScanCheckedAt: params.llmAnalysis?.checkedAt,
    clawScanSummary: limitDigestText(params.llmAnalysis?.summary),
    clawScanModel: params.llmAnalysis?.model,
    clawScanPrimaryRiskBucket: primaryFinding?.riskBucket,
    clawScanPrimaryCategoryKey: primaryFinding?.categoryId,
    clawScanPrimaryCategoryLabel: primaryFinding?.categoryLabel,
    clawScanVisibleFindingCount: getVisibleAgenticRiskFindings(params.llmAnalysis).length,
    clawScanHighestSeverity: getHighestVisibleSeverity(params.llmAnalysis),
    scanJobStatus,
    failureStatus,
    ...getJobTiming(params.scanJob),
    skillSpectorStatus: params.skillSpectorAnalysis?.status,
    skillSpectorScore: params.skillSpectorAnalysis?.score,
    skillSpectorSeverity: params.skillSpectorAnalysis?.severity,
    skillSpectorRecommendation: params.skillSpectorAnalysis?.recommendation,
    skillSpectorIssueCount: params.skillSpectorAnalysis?.issueCount,
    skillSpectorTopCategory: getSkillSpectorTopCategory(params.skillSpectorAnalysis),
    skillSpectorCheckedAt: params.skillSpectorAnalysis?.checkedAt,
    staticStatus: params.staticScan?.status,
    staticReasonCount: params.staticScan?.reasonCodes.length,
    staticCheckedAt: params.staticScan?.checkedAt,
    vtStatus: params.vtAnalysis?.status,
    vtVerdict: params.vtAnalysis?.verdict,
    vtMalicious: vtStats?.malicious,
    vtSuspicious: vtStats?.suspicious,
    vtCheckedAt: params.vtAnalysis?.checkedAt,
    evidenceUpdatedAt: getEvidenceUpdatedAt(params),
  };
}

export function buildSkillSecurityScanArtifactState(params: {
  skill: SkillDigestInput;
  version: SkillVersionDigestInput;
  scanJob?: SecurityScanJobLike | null;
  now: number;
}): SecurityScanArtifactStateFields {
  return {
    artifactKind: "skill",
    targetKind: "skillVersion",
    artifactKey: `skill:${params.skill._id}`,
    targetKey: `skillVersion:${params.version._id}`,
    skillId: params.skill._id,
    skillVersionId: params.version._id,
    ownerUserId: params.skill.ownerUserId,
    ownerPublisherId: params.skill.ownerPublisherId,
    slug: params.skill.slug,
    displayName: params.skill.displayName,
    version: params.version.version,
    ...buildSharedScanFields({
      llmAnalysis: params.version.llmAnalysis,
      skillSpectorAnalysis: params.version.skillSpectorAnalysis,
      staticScan: params.version.staticScan,
      vtAnalysis: params.version.vtAnalysis,
      scanJob: params.scanJob,
    }),
    createdAt: params.now,
    updatedAt: params.now,
  };
}

export function buildPluginSecurityScanArtifactState(params: {
  pkg: PackageDigestInput;
  release: PackageReleaseDigestInput;
  scanJob?: SecurityScanJobLike | null;
  now: number;
}): SecurityScanArtifactStateFields {
  return {
    artifactKind: "plugin",
    targetKind: "packageRelease",
    artifactKey: `plugin:${params.pkg._id}`,
    targetKey: `packageRelease:${params.release._id}`,
    packageId: params.pkg._id,
    packageReleaseId: params.release._id,
    ownerUserId: params.pkg.ownerUserId,
    ownerPublisherId: params.pkg.ownerPublisherId,
    name: params.pkg.name,
    displayName: params.pkg.displayName,
    version: params.release.version,
    ...buildSharedScanFields({
      llmAnalysis: params.release.llmAnalysis,
      skillSpectorAnalysis: params.release.skillSpectorAnalysis,
      staticScan: params.release.staticScan,
      vtAnalysis: params.release.vtAnalysis,
      scanJob: params.scanJob,
    }),
    createdAt: params.now,
    updatedAt: params.now,
  };
}

export function getCurrentRollupEntriesForState(
  state: Pick<
    SecurityScanArtifactStateFields,
    | "artifactKind"
    | "clawScanVerdict"
    | "scanJobStatus"
    | "failureStatus"
    | "clawScanPrimaryRiskBucket"
    | "clawScanPrimaryCategoryKey"
    | "clawScanPrimaryCategoryLabel"
  >,
): SecurityScanCurrentRollupDimensions[] {
  const base = {
    artifactKind: state.artifactKind,
    clawScanVerdict: state.clawScanVerdict,
    scanJobStatus: state.scanJobStatus,
    failureStatus: state.failureStatus,
  };
  const entries: SecurityScanCurrentRollupDimensions[] = [
    {
      ...base,
      rollupKind: "all",
      categoryKey: "all",
      categoryLabel: "All artifacts",
    },
  ];
  if (state.clawScanPrimaryRiskBucket) {
    entries.push({
      ...base,
      rollupKind: "clawscanRiskBucket",
      categoryKey: state.clawScanPrimaryRiskBucket,
      categoryLabel:
        RISK_BUCKET_LABELS[state.clawScanPrimaryRiskBucket] ?? state.clawScanPrimaryRiskBucket,
    });
  }
  if (state.clawScanPrimaryCategoryKey) {
    entries.push({
      ...base,
      rollupKind: "clawscanCategory",
      categoryKey: state.clawScanPrimaryCategoryKey,
      categoryLabel: state.clawScanPrimaryCategoryLabel ?? state.clawScanPrimaryCategoryKey,
    });
  }
  return entries;
}

function rollupEntryKey(entry: SecurityScanCurrentRollupDimensions) {
  return [
    entry.artifactKind,
    entry.rollupKind,
    entry.categoryKey,
    entry.clawScanVerdict,
    entry.scanJobStatus,
    entry.failureStatus,
  ].join("|");
}

export function getCurrentRollupDeltas(
  previous: SecurityScanArtifactStateFields | null | undefined,
  next: SecurityScanArtifactStateFields | null | undefined,
): SecurityScanRollupDelta[] {
  const deltas = new Map<string, SecurityScanRollupDelta>();
  const addDelta = (entry: SecurityScanCurrentRollupDimensions, delta: 1 | -1) => {
    const key = rollupEntryKey(entry);
    const existing = deltas.get(key);
    if (!existing) {
      deltas.set(key, { dimensions: entry, delta });
      return;
    }
    const combined = existing.delta + delta;
    if (combined === 0) {
      deltas.delete(key);
      return;
    }
    deltas.set(key, { dimensions: entry, delta: combined > 0 ? 1 : -1 });
  };
  if (previous) {
    for (const entry of getCurrentRollupEntriesForState(previous)) addDelta(entry, -1);
  }
  if (next) {
    for (const entry of getCurrentRollupEntriesForState(next)) addDelta(entry, 1);
  }
  return [...deltas.values()];
}
