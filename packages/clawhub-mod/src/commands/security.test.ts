/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthTokenModuleMocks,
  createHttpModuleMocks,
  createRegistryModuleMocks,
  createUiModuleMocks,
  makeGlobalOpts,
} from "../../../clawhub/test/cliCommandTestKit.js";

const authTokenMocks = createAuthTokenModuleMocks();
const registryMocks = createRegistryModuleMocks();
const httpMocks = createHttpModuleMocks();
const uiMocks = createUiModuleMocks();

vi.mock("../../../clawhub/src/cli/authToken.js", () => authTokenMocks.moduleFactory());
vi.mock("../../../clawhub/src/cli/registry.js", () => registryMocks.moduleFactory());
vi.mock("../../../clawhub/src/http.js", () => httpMocks.moduleFactory());
vi.mock("../../../clawhub/src/cli/ui.js", () => uiMocks.moduleFactory());

const { cmdPluginSecurityRescan, cmdSecuritySummary, cmdSkillSecurityRescan } =
  await import("./security");

afterEach(() => {
  vi.clearAllMocks();
});

describe("cmdSecuritySummary", () => {
  it("fetches the staff security summary", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      generatedAt: 123,
      updatedAt: 122,
      totals: {
        skills: { benign: 1, suspicious: 2, malicious: 3, pending: 4, unknown: 5 },
        plugins: { benign: 6, suspicious: 7, malicious: 8, pending: 9, unknown: 10 },
      },
      stale: false,
    });

    await cmdSecuritySummary(makeGlobalOpts(), {});

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "GET",
        path: "/api/v1/security/summary",
      }),
      expect.anything(),
    );
  });
});

describe("security rescan commands", () => {
  it("requires --yes for non-interactive skill rescans", async () => {
    await expect(cmdSkillSecurityRescan(makeGlobalOpts(), "demo", {}, false)).rejects.toThrow(
      /--yes/i,
    );
  });

  it("posts skill rescan requests", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      state: "queued",
      entityType: "skill",
      target: "demo",
      scheduledScanners: ["static", "clawscan", "virustotal"],
    });

    await cmdSkillSecurityRescan(makeGlobalOpts(), "demo", { yes: true }, false);

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/security/skills/demo/rescan",
      }),
      expect.anything(),
    );
  });

  it("posts plugin rescan requests with an optional version", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      state: "queued",
      entityType: "plugin",
      target: "@scope/demo",
      version: "1.2.3",
      scheduledScanners: ["static", "clawscan", "virustotal"],
    });

    await cmdPluginSecurityRescan(
      makeGlobalOpts(),
      "@scope/demo",
      { version: "1.2.3", yes: true },
      false,
    );

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/security/plugins/%40scope%2Fdemo/rescan",
        body: { version: "1.2.3" },
      }),
      expect.anything(),
    );
  });
});
