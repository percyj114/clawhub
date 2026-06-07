import type { Doc } from "../_generated/dataModel";
import {
  isRetainedScannerSuspiciousReason,
  isScannerMaliciousReason,
  isScannerSuspiciousReason,
  legacyFlagsFromVerdict,
  RETIRED_DEP_REGISTRY_REASON_CODE,
  stripRetiredDependencyRegistryReasonCodes,
  summarizeReasonCodesWithScannerReason,
  verdictFromCodes,
  verdictFromCodesWithScannerReason,
} from "./moderationReasonCodes";

function isScannerManagedReason(reason: string | undefined) {
  return reason?.startsWith("scanner.") === true;
}

function normalizeAnalysisStatus(status: string | undefined) {
  return status?.trim().toLowerCase();
}

function hasReviewReasonCode(codes: readonly string[] | undefined) {
  return (codes ?? []).some((code) => code.startsWith("review."));
}

function hasRetiredDependencyRegistryEvidence(evidence: readonly { code: string }[] | undefined) {
  return (evidence ?? []).some((finding) => finding.code === RETIRED_DEP_REGISTRY_REASON_CODE);
}

export function resolveScannerModerationReason(params: {
  vtStatus?: string;
  llmStatus?: string;
  verdict?: Doc<"skills">["moderationVerdict"];
}) {
  const vtStatus = normalizeAnalysisStatus(params.vtStatus);
  const llmStatus = normalizeAnalysisStatus(params.llmStatus);

  if (params.verdict === "clean" && (vtStatus === "suspicious" || llmStatus === "suspicious")) {
    return "scanner.aggregate.clean";
  }
  if (vtStatus === "malicious") return "scanner.vt.malicious";
  if (llmStatus === "malicious") return "scanner.llm.malicious";
  if (vtStatus === "suspicious") return "scanner.vt.suspicious";
  if (llmStatus === "suspicious") return "scanner.llm.suspicious";
  if (vtStatus === "pending" || vtStatus === "loading" || vtStatus === "not_found") {
    return "scanner.vt.pending";
  }
  if (llmStatus === "pending" || llmStatus === "loading") return "scanner.llm.pending";
  if (vtStatus === "clean") return "scanner.vt.clean";
  if (llmStatus === "clean") return "scanner.llm.clean";
  if (params.verdict === "malicious") return "scanner.aggregate.malicious";
  if (params.verdict === "suspicious") return "scanner.aggregate.suspicious";
  return "scanner.aggregate.clean";
}

export type EffectiveSkillModerationState = {
  isMalwareBlocked: boolean;
  isSuspicious: boolean;
  isReviewFlagged: boolean;
  moderationStatus: Doc<"skills">["moderationStatus"];
  moderationFlags: Doc<"skills">["moderationFlags"];
  moderationReason: Doc<"skills">["moderationReason"];
  verdict: Doc<"skills">["moderationVerdict"];
  reasonCodes: string[] | undefined;
  summary: string | undefined;
};

export function getEffectiveSkillModerationState(
  skill: Pick<
    Doc<"skills">,
    | "moderationFlags"
    | "moderationReason"
    | "moderationReasonCodes"
    | "moderationEvidence"
    | "moderationSummary"
    | "moderationStatus"
    | "moderationVerdict"
  >,
): EffectiveSkillModerationState {
  const isMalwareBlocked =
    skill.moderationVerdict === "malicious" ||
    isSkillBlockedByMalware(skill) ||
    isScannerMaliciousReason(skill.moderationReason);
  const isSuspicious = isSkillSuspicious(skill);
  const isReviewFlagged = isSkillReviewFlagged(skill);
  const rawReasonCodes = skill.moderationReasonCodes ?? [];
  const reasonCodes = stripRetiredDependencyRegistryReasonCodes(rawReasonCodes);
  const hasRetiredReasonCode = reasonCodes.length !== rawReasonCodes.length;
  const hasRetiredEvidence = hasRetiredDependencyRegistryEvidence(skill.moderationEvidence);
  if (!hasRetiredReasonCode && !hasRetiredEvidence) {
    return {
      isMalwareBlocked,
      isSuspicious,
      isReviewFlagged,
      moderationStatus: skill.moderationStatus,
      moderationFlags: skill.moderationFlags,
      moderationReason: skill.moderationReason,
      verdict: skill.moderationVerdict,
      reasonCodes: skill.moderationReasonCodes,
      summary: skill.moderationSummary,
    };
  }

  if (!isScannerManagedReason(skill.moderationReason)) {
    const effectiveReasonCodes = hasRetiredReasonCode
      ? reasonCodes.length
        ? reasonCodes
        : undefined
      : skill.moderationReasonCodes;
    return {
      isMalwareBlocked,
      isSuspicious,
      isReviewFlagged,
      moderationStatus: skill.moderationStatus,
      moderationFlags: skill.moderationFlags,
      moderationReason: skill.moderationReason,
      verdict: skill.moderationVerdict,
      reasonCodes: effectiveReasonCodes,
      summary: skill.moderationSummary,
    };
  }

  const verdict = verdictFromCodesWithScannerReason({
    reasonCodes,
    scannerReason: skill.moderationReason,
    isMalwareBlocked,
  });
  const derivedFlags =
    verdict === "clean" && hasReviewReasonCode(reasonCodes)
      ? ["flagged.review"]
      : legacyFlagsFromVerdict(verdict);
  const effectiveIsMalwareBlocked =
    isMalwareBlocked || derivedFlags?.includes("blocked.malware") === true;
  const moderationFlags = effectiveIsMalwareBlocked ? ["blocked.malware"] : derivedFlags;
  const moderationStatus =
    skill.moderationStatus === "removed"
      ? "removed"
      : effectiveIsMalwareBlocked || verdict === "malicious"
        ? "hidden"
        : "active";

  return {
    isMalwareBlocked: effectiveIsMalwareBlocked,
    isSuspicious:
      !effectiveIsMalwareBlocked && moderationFlags?.includes("flagged.suspicious") === true,
    isReviewFlagged: isReviewFlagged || moderationFlags?.includes("flagged.review") === true,
    moderationStatus,
    moderationFlags,
    moderationReason:
      verdict === "suspicious" &&
      reasonCodes.length === 0 &&
      isRetainedScannerSuspiciousReason(skill.moderationReason)
        ? skill.moderationReason
        : resolveScannerModerationReason({ verdict }),
    verdict,
    reasonCodes: reasonCodes.length ? reasonCodes : undefined,
    summary: summarizeReasonCodesWithScannerReason({
      reasonCodes,
      scannerReason: skill.moderationReason,
      isMalwareBlocked: effectiveIsMalwareBlocked,
    }),
  };
}

export function applyEffectiveModerationForPublicSkill<
  T extends Pick<Doc<"skills">, "isSuspicious">,
>(
  skill: T,
  effectiveModeration: EffectiveSkillModerationState,
): T &
  Pick<
    Doc<"skills">,
    "moderationStatus" | "moderationFlags" | "moderationReason" | "isSuspicious"
  > {
  return {
    ...skill,
    moderationStatus: effectiveModeration.moderationStatus,
    moderationFlags: effectiveModeration.moderationFlags,
    moderationReason: effectiveModeration.moderationReason,
    isSuspicious: effectiveModeration.isSuspicious,
  };
}

export function isSkillSuspicious(
  skill: Pick<Doc<"skills">, "moderationFlags" | "moderationReason">,
) {
  if (skill.moderationFlags?.includes("flagged.suspicious")) return true;
  return isScannerSuspiciousReason(skill.moderationReason);
}

export function isSkillBlockedByMalware(skill: Pick<Doc<"skills">, "moderationFlags">) {
  return skill.moderationFlags?.includes("blocked.malware") ?? false;
}

export function isSkillTransferBlockedByModeration(
  skill: Pick<
    Doc<"skills">,
    | "moderationStatus"
    | "moderationVerdict"
    | "isSuspicious"
    | "moderationFlags"
    | "moderationReason"
    | "moderationReasonCodes"
    | "moderationEvidence"
    | "softDeletedAt"
  >,
) {
  const rawModerationStatus = skill.moderationStatus ?? "active";
  const rawReasonCodes = skill.moderationReasonCodes ?? [];
  const reasonCodes = stripRetiredDependencyRegistryReasonCodes(rawReasonCodes);
  const hasRetiredModeration =
    reasonCodes.length !== rawReasonCodes.length ||
    hasRetiredDependencyRegistryEvidence(skill.moderationEvidence);
  const shouldRecomputeScannerState =
    hasRetiredModeration && isScannerManagedReason(skill.moderationReason);
  const rawIsMalwareBlocked =
    skill.moderationVerdict === "malicious" ||
    isSkillBlockedByMalware(skill) ||
    isScannerMaliciousReason(skill.moderationReason);
  const moderationVerdict = shouldRecomputeScannerState
    ? verdictFromCodesWithScannerReason({
        reasonCodes,
        scannerReason: skill.moderationReason,
        isMalwareBlocked: rawIsMalwareBlocked,
      })
    : (skill.moderationVerdict ?? verdictFromCodes(rawReasonCodes));
  const moderationFlags: Doc<"skills">["moderationFlags"] = shouldRecomputeScannerState
    ? rawIsMalwareBlocked
      ? ["blocked.malware"]
      : legacyFlagsFromVerdict(moderationVerdict)
    : skill.moderationFlags;
  const moderationStatus = shouldRecomputeScannerState
    ? rawModerationStatus === "removed"
      ? "removed"
      : rawIsMalwareBlocked || moderationVerdict === "malicious"
        ? "hidden"
        : "active"
    : rawModerationStatus;
  const moderationReason =
    shouldRecomputeScannerState &&
    !rawIsMalwareBlocked &&
    !isRetainedScannerSuspiciousReason(skill.moderationReason)
      ? undefined
      : skill.moderationReason;
  const isSuspicious = shouldRecomputeScannerState
    ? moderationFlags?.includes("flagged.suspicious")
    : skill.isSuspicious;
  return (
    skill.softDeletedAt !== undefined ||
    moderationStatus !== "active" ||
    moderationVerdict === "suspicious" ||
    moderationVerdict === "malicious" ||
    isSuspicious ||
    moderationFlags?.includes("flagged.suspicious") ||
    isSkillBlockedByMalware({ moderationFlags }) ||
    isSkillSuspicious({ moderationFlags, moderationReason }) ||
    isScannerMaliciousReason(moderationReason)
  );
}

export function isSkillReviewFlagged(skill: Pick<Doc<"skills">, "moderationFlags">) {
  return skill.moderationFlags?.includes("flagged.review") ?? false;
}

/**
 * Compute the denormalized `isSuspicious` boolean for a skill.
 * Use at every mutation site that writes `moderationFlags` or `moderationReason`.
 */
export function computeIsSuspicious(
  skill: Pick<Doc<"skills">, "moderationFlags" | "moderationReason">,
): boolean {
  return isSkillSuspicious(skill);
}
