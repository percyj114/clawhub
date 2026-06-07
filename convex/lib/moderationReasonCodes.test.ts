import { describe, expect, it } from "vitest";
import {
  isScannerMaliciousReason,
  stripRetiredDependencyRegistryStaticScan,
  type StaticScanSnapshot,
} from "./moderationReasonCodes";

describe("isScannerMaliciousReason", () => {
  it("detects legacy scanner malicious moderation reasons", () => {
    expect(isScannerMaliciousReason("scanner.vt.malicious")).toBe(true);
    expect(isScannerMaliciousReason("scanner.llm.malicious")).toBe(true);
    expect(isScannerMaliciousReason("scanner.aggregate.suspicious")).toBe(false);
    expect(isScannerMaliciousReason(undefined)).toBe(false);
  });
});

describe("stripRetiredDependencyRegistryStaticScan", () => {
  it("preserves active findings when scrubbing retired dependency registry evidence", () => {
    const activeFinding = {
      code: "suspicious.dynamic_code_execution",
      severity: "critical" as const,
      file: "index.ts",
      line: 7,
      message: "Dynamic code execution detected.",
      evidence: "eval(payload)",
    };
    const staticScan: StaticScanSnapshot = {
      status: "suspicious",
      reasonCodes: ["suspicious.dep_not_found_on_registry", "suspicious.dynamic_code_execution"],
      findings: [
        {
          code: "suspicious.dep_not_found_on_registry",
          severity: "warn",
          file: "package.json",
          line: 3,
          message: "Dependency was not found on the registry.",
          evidence: "left-padx",
        },
        activeFinding,
      ],
      summary: "Detected: suspicious.dep_not_found_on_registry, suspicious.dynamic_code_execution",
      engineVersion: "static-v1",
      checkedAt: 1_700_000_000_000,
    };

    const result = stripRetiredDependencyRegistryStaticScan(staticScan);

    expect(result).toEqual({
      status: "suspicious",
      reasonCodes: ["suspicious.dynamic_code_execution"],
      findings: [activeFinding],
      summary: "Detected: suspicious.dynamic_code_execution",
      engineVersion: "static-v1",
      checkedAt: 1_700_000_000_000,
    });
    expect(JSON.stringify(result)).not.toContain("suspicious.dep_not_found_on_registry");
    expect(JSON.stringify(result)).not.toContain("left-padx");
  });
});
