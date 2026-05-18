import { describe, expect, it } from "vitest";
import {
  getSecurityScanRollupDeltas,
  securityScanStatusFromPackage,
  securityScanStatusFromSkill,
} from "./securityScanRollups";

describe("security scan rollup helpers", () => {
  it("maps skill moderation state to staff scan buckets", () => {
    expect(
      securityScanStatusFromSkill({ softDeletedAt: undefined, moderationVerdict: "clean" }),
    ).toBe("benign");
    expect(
      securityScanStatusFromSkill({ softDeletedAt: undefined, moderationVerdict: "suspicious" }),
    ).toBe("suspicious");
    expect(
      securityScanStatusFromSkill({ softDeletedAt: undefined, moderationVerdict: "malicious" }),
    ).toBe("malicious");
    expect(
      securityScanStatusFromSkill({
        softDeletedAt: undefined,
        moderationVerdict: undefined,
        isSuspicious: true,
      }),
    ).toBe("suspicious");
    expect(
      securityScanStatusFromSkill({
        softDeletedAt: undefined,
        moderationVerdict: "clean",
        moderationReason: "pending.scan.stale",
      }),
    ).toBe("pending");
    expect(securityScanStatusFromSkill({ softDeletedAt: undefined })).toBe("unknown");
    expect(
      securityScanStatusFromSkill({ softDeletedAt: Date.now(), moderationVerdict: "clean" }),
    ).toBeNull();
  });

  it("maps plugin scan state to staff scan buckets", () => {
    expect(securityScanStatusFromPackage({ softDeletedAt: undefined, scanStatus: "clean" })).toBe(
      "benign",
    );
    expect(
      securityScanStatusFromPackage({ softDeletedAt: undefined, scanStatus: "suspicious" }),
    ).toBe("suspicious");
    expect(
      securityScanStatusFromPackage({ softDeletedAt: undefined, scanStatus: "malicious" }),
    ).toBe("malicious");
    expect(securityScanStatusFromPackage({ softDeletedAt: undefined, scanStatus: "pending" })).toBe(
      "pending",
    );
    expect(securityScanStatusFromPackage({ softDeletedAt: undefined, scanStatus: "not-run" })).toBe(
      "unknown",
    );
    expect(
      securityScanStatusFromPackage({ softDeletedAt: Date.now(), scanStatus: "clean" }),
    ).toBeNull();
  });

  it("emits one decrement and one increment for status transitions", () => {
    expect(getSecurityScanRollupDeltas("suspicious", "benign")).toEqual([
      { status: "suspicious", delta: -1 },
      { status: "benign", delta: 1 },
    ]);
    expect(getSecurityScanRollupDeltas("benign", "benign")).toEqual([]);
    expect(getSecurityScanRollupDeltas(null, "malicious")).toEqual([
      { status: "malicious", delta: 1 },
    ]);
    expect(getSecurityScanRollupDeltas("pending", null)).toEqual([
      { status: "pending", delta: -1 },
    ]);
  });
});
