import { describe, expect, it } from "vitest";
import { buildMirrorProofHeaders } from "./prove-mirror-request";

describe("skills.sh mirror proof request headers", () => {
  it("carries the Test deployment protection bypass without changing operator auth", () => {
    expect(buildMirrorProofHeaders("operator-token", " bypass-secret ")).toEqual({
      Authorization: "Bearer operator-token",
      "Content-Type": "application/json",
      "x-vercel-protection-bypass": "bypass-secret",
    });
  });

  it("omits the bypass header outside protected deployments", () => {
    expect(buildMirrorProofHeaders("operator-token")).toEqual({
      Authorization: "Bearer operator-token",
      "Content-Type": "application/json",
    });
  });
});
