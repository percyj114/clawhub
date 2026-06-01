import type { Id } from "../_generated/dataModel";

type SkillFileModerationInfo = {
  isPendingScan?: boolean | null;
  isMalwareBlocked?: boolean | null;
  isHiddenByMod?: boolean | null;
  isRemoved?: boolean | null;
  overrideActive?: boolean | null;
  verdict?: string | null;
};

type SkillFileAccessBlock = {
  status: number;
  message: string;
};

type SkillVersionSecurityInfo = {
  vtAnalysis?: { status?: string | null; verdict?: string | null } | null;
  llmAnalysis?: { status?: string | null; verdict?: string | null } | null;
  softDeletedAt?: number | null;
};

export function getPublicSkillFileAccessBlock(
  moderationInfo: SkillFileModerationInfo | null | undefined,
): SkillFileAccessBlock | null {
  if (moderationInfo?.isMalwareBlocked) {
    return {
      status: 403,
      message:
        "Blocked: this skill has been flagged as malicious by ClawScan and cannot be downloaded.",
    };
  }
  if (moderationInfo?.isPendingScan) {
    return {
      status: 423,
      message:
        "This skill is pending a ClawScan security review. Please try again in a few minutes.",
    };
  }
  if (moderationInfo?.isRemoved) {
    return { status: 410, message: "This skill has been removed by a moderator." };
  }
  if (moderationInfo?.isHiddenByMod) {
    return { status: 403, message: "This skill is currently unavailable." };
  }
  return null;
}

export function getPublicSkillVersionFileAccessBlock(
  version: SkillVersionSecurityInfo | null | undefined,
  _moderationInfo?: SkillFileModerationInfo | null,
): SkillFileAccessBlock | null {
  if (version?.softDeletedAt) {
    return { status: 410, message: "Version not available" };
  }
  if (hasVersionSecurityStatus(version, "malicious")) {
    return {
      status: 403,
      message:
        "Blocked: this skill version has been flagged as malicious by ClawScan and cannot be served.",
    };
  }
  if (hasVersionSecurityStatus(version, "pending")) {
    return {
      status: 423,
      message:
        "This skill version is pending a ClawScan security review. Please try again in a few minutes.",
    };
  }
  return null;
}

export function isSkillVersionForSkill(
  version: { skillId?: Id<"skills"> | string | null } | null | undefined,
  skillId: Id<"skills"> | string,
) {
  return version?.skillId === skillId;
}

export function isPublicSkillVersionAvailableForSkill(
  version:
    | {
        skillId?: Id<"skills"> | string | null;
        softDeletedAt?: number | null;
      }
    | null
    | undefined,
  skillId: Id<"skills"> | string,
) {
  return Boolean(version && !version.softDeletedAt && isSkillVersionForSkill(version, skillId));
}

function hasVersionSecurityStatus(
  version: SkillVersionSecurityInfo | null | undefined,
  status: "malicious" | "pending",
) {
  if (!version) return false;
  return [
    version.vtAnalysis?.verdict,
    version.vtAnalysis?.status,
    version.llmAnalysis?.verdict,
    version.llmAnalysis?.status,
  ].some((value) => normalizeVersionSecurityStatus(value) === status);
}

function normalizeVersionSecurityStatus(value: string | null | undefined) {
  switch (value?.trim().toLowerCase()) {
    case "malicious":
      return "malicious";
    case "pending":
    case "loading":
      return "pending";
    default:
      return null;
  }
}
