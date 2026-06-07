import { describe, expect, it } from "vitest";
import {
  getEffectiveSkillModerationState,
  isSkillReviewFlagged,
  isSkillSuspicious,
  isSkillTransferBlockedByModeration,
} from "./skillSafety";

describe("isSkillSuspicious", () => {
  it("returns true when suspicious flag is present", () => {
    expect(
      isSkillSuspicious({
        moderationFlags: ["flagged.suspicious"],
        moderationReason: undefined,
      }),
    ).toBe(true);
  });

  it("returns true for scanner suspicious reason", () => {
    expect(
      isSkillSuspicious({
        moderationFlags: [],
        moderationReason: "scanner.vt.suspicious",
      }),
    ).toBe(true);
  });

  it("returns false for clean moderation states", () => {
    expect(
      isSkillSuspicious({
        moderationFlags: [],
        moderationReason: "scanner.vt.clean",
      }),
    ).toBe(false);
  });

  it("keeps review flags out of the hidden suspicious bucket", () => {
    const skill = {
      moderationFlags: ["flagged.review"],
      moderationReason: "scanner.llm.review",
    };

    expect(isSkillSuspicious(skill)).toBe(false);
    expect(isSkillReviewFlagged(skill)).toBe(true);
  });
});

describe("getEffectiveSkillModerationState", () => {
  it("ignores retired dependency registry moderation stored only in evidence", () => {
    const result = getEffectiveSkillModerationState({
      moderationStatus: "hidden",
      moderationVerdict: "suspicious",
      moderationFlags: ["flagged.suspicious"],
      moderationReason: "scanner.aggregate.suspicious",
      moderationReasonCodes: [],
      moderationSummary: "Detected: suspicious.dep_not_found_on_registry",
      moderationEvidence: [
        {
          code: "suspicious.dep_not_found_on_registry",
          severity: "critical",
          file: "Dependency manifests",
          line: 1,
          message: "missing dependency",
          evidence: "legacy dependency registry evidence",
        },
      ],
    });

    expect(result).toMatchObject({
      isMalwareBlocked: false,
      isSuspicious: false,
      isReviewFlagged: false,
      moderationStatus: "active",
      moderationFlags: undefined,
      moderationReason: "scanner.aggregate.clean",
      verdict: "clean",
      reasonCodes: undefined,
      summary: "No suspicious patterns detected.",
    });
  });

  it("preserves hidden locks when retired dependency registry rows have no moderation reason", () => {
    const result = getEffectiveSkillModerationState({
      moderationStatus: "hidden",
      moderationVerdict: "suspicious",
      moderationFlags: ["flagged.suspicious"],
      moderationReason: undefined,
      moderationReasonCodes: ["suspicious.dep_not_found_on_registry"],
      moderationSummary: "Legacy hidden lock",
      moderationEvidence: [
        {
          code: "suspicious.dep_not_found_on_registry",
          severity: "critical",
          file: "Dependency manifests",
          line: 1,
          message: "missing dependency",
          evidence: "legacy dependency registry evidence",
        },
      ],
    });

    expect(result).toMatchObject({
      isMalwareBlocked: false,
      isSuspicious: true,
      isReviewFlagged: false,
      moderationStatus: "hidden",
      moderationFlags: ["flagged.suspicious"],
      moderationReason: undefined,
      verdict: "suspicious",
      reasonCodes: undefined,
      summary: "Legacy hidden lock",
    });
  });

  it("preserves scanner-specific suspicious reasons when retired codes are stripped", () => {
    const result = getEffectiveSkillModerationState({
      moderationStatus: "hidden",
      moderationVerdict: "suspicious",
      moderationFlags: ["flagged.suspicious"],
      moderationReason: "scanner.vt.suspicious",
      moderationReasonCodes: ["suspicious.dep_not_found_on_registry"],
      moderationSummary: "Detected: suspicious.dep_not_found_on_registry",
      moderationEvidence: [
        {
          code: "suspicious.dep_not_found_on_registry",
          severity: "critical",
          file: "Dependency manifests",
          line: 1,
          message: "missing dependency",
          evidence: "legacy dependency registry evidence",
        },
      ],
    });

    expect(result).toMatchObject({
      isMalwareBlocked: false,
      isSuspicious: true,
      isReviewFlagged: false,
      moderationStatus: "active",
      moderationFlags: ["flagged.suspicious"],
      moderationReason: "scanner.vt.suspicious",
      verdict: "suspicious",
      reasonCodes: undefined,
      summary: "Detected: scanner.vt.suspicious",
    });
  });
});

describe("isSkillTransferBlockedByModeration", () => {
  it("ignores scanner state from retired dependency registry checks", () => {
    expect(
      isSkillTransferBlockedByModeration({
        moderationStatus: "active",
        moderationVerdict: "suspicious",
        isSuspicious: true,
        moderationFlags: ["flagged.suspicious"],
        moderationReason: "scanner.aggregate.suspicious",
        moderationReasonCodes: ["suspicious.dep_not_found_on_registry"],
        softDeletedAt: undefined,
      }),
    ).toBe(false);
  });

  it("unblocks legacy hidden skills that were only hidden by retired dependency registry checks", () => {
    expect(
      isSkillTransferBlockedByModeration({
        moderationStatus: "hidden",
        moderationVerdict: "suspicious",
        isSuspicious: true,
        moderationFlags: ["flagged.suspicious"],
        moderationReason: "scanner.aggregate.suspicious",
        moderationReasonCodes: ["suspicious.dep_not_found_on_registry"],
        softDeletedAt: undefined,
      }),
    ).toBe(false);
  });

  it("keeps hidden legacy skills blocked when retired dependency registry rows have no moderation reason", () => {
    expect(
      isSkillTransferBlockedByModeration({
        moderationStatus: "hidden",
        moderationVerdict: "suspicious",
        isSuspicious: true,
        moderationFlags: ["flagged.suspicious"],
        moderationReason: undefined,
        moderationReasonCodes: ["suspicious.dep_not_found_on_registry"],
        softDeletedAt: undefined,
      }),
    ).toBe(true);
  });

  it("blocks transfer when another suspicious scanner reason remains", () => {
    expect(
      isSkillTransferBlockedByModeration({
        moderationStatus: "active",
        moderationVerdict: "suspicious",
        isSuspicious: true,
        moderationFlags: ["flagged.suspicious"],
        moderationReason: "scanner.aggregate.suspicious",
        moderationReasonCodes: [
          "suspicious.dep_not_found_on_registry",
          "suspicious.dynamic_code_execution",
        ],
        softDeletedAt: undefined,
      }),
    ).toBe(true);
  });

  it("blocks transfer when a scanner-specific suspicious reason remains", () => {
    expect(
      isSkillTransferBlockedByModeration({
        moderationStatus: "active",
        moderationVerdict: "suspicious",
        isSuspicious: true,
        moderationFlags: ["flagged.suspicious"],
        moderationReason: "scanner.vt.suspicious",
        moderationReasonCodes: ["suspicious.dep_not_found_on_registry"],
        moderationEvidence: [
          {
            code: "suspicious.dep_not_found_on_registry",
            severity: "critical",
            file: "Dependency manifests",
            line: 1,
            message: "missing dependency",
            evidence: "legacy dependency registry evidence",
          },
        ],
        softDeletedAt: undefined,
      }),
    ).toBe(true);
  });

  it("keeps malware-blocked skills blocked when stripping retired dependency registry checks", () => {
    expect(
      isSkillTransferBlockedByModeration({
        moderationStatus: "hidden",
        moderationVerdict: "malicious",
        isSuspicious: false,
        moderationFlags: ["blocked.malware"],
        moderationReason: "scanner.aggregate.suspicious",
        moderationReasonCodes: ["suspicious.dep_not_found_on_registry"],
        softDeletedAt: undefined,
      }),
    ).toBe(true);
  });

  it("keeps malicious verdict skills blocked when stripping retired dependency registry checks", () => {
    expect(
      isSkillTransferBlockedByModeration({
        moderationStatus: "hidden",
        moderationVerdict: "malicious",
        isSuspicious: false,
        moderationFlags: undefined,
        moderationReason: "scanner.vt.malicious",
        moderationReasonCodes: ["suspicious.dep_not_found_on_registry"],
        softDeletedAt: undefined,
      }),
    ).toBe(true);
  });

  it("blocks scanner malicious reasons even when verdict fields are missing", () => {
    expect(
      isSkillTransferBlockedByModeration({
        moderationStatus: "active",
        moderationVerdict: undefined,
        isSuspicious: false,
        moderationFlags: undefined,
        moderationReason: "scanner.vt.malicious",
        moderationReasonCodes: undefined,
        softDeletedAt: undefined,
      }),
    ).toBe(true);
  });

  it("keeps legacy scanner malicious reasons blocked while stripping retired dependency checks", () => {
    expect(
      isSkillTransferBlockedByModeration({
        moderationStatus: "active",
        moderationVerdict: undefined,
        isSuspicious: false,
        moderationFlags: undefined,
        moderationReason: "scanner.vt.malicious",
        moderationReasonCodes: ["suspicious.dep_not_found_on_registry"],
        softDeletedAt: undefined,
      }),
    ).toBe(true);
  });

  it("blocks legacy hidden skills that only have softDeletedAt", () => {
    expect(
      isSkillTransferBlockedByModeration({
        moderationStatus: undefined,
        moderationVerdict: undefined,
        isSuspicious: false,
        moderationFlags: undefined,
        moderationReason: undefined,
        moderationReasonCodes: undefined,
        softDeletedAt: 123,
      }),
    ).toBe(true);
  });
});
