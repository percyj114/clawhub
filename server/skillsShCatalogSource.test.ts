/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import {
  fetchSkillsShCatalogDetail,
  fetchSkillsShCatalogPage,
  getSkillsShCatalogTestSourcePolicy,
} from "./skillsShCatalogSource";

describe("skills.sh Vercel source boundary", () => {
  it("uses only the injected Vercel OIDC token for source authentication", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [],
          pagination: { page: 0, perPage: 500, total: 0, hasMore: false },
        }),
      );
    });

    await fetchSkillsShCatalogPage(
      { page: 0, perPage: 500 },
      {
        env: { VERCEL_OIDC_TOKEN: "short-lived-vercel-oidc" },
        fetchImpl,
      },
    );

    expect(fetchImpl).toHaveBeenCalledWith("https://skills.sh/api/v1/skills?page=0&per_page=500", {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer short-lived-vercel-oidc",
      },
    });
  });

  it("fails closed without OIDC and above the 500-row boundary", async () => {
    await expect(
      fetchSkillsShCatalogPage({ page: 0, perPage: 500 }, { env: {}, fetchImpl: vi.fn() }),
    ).rejects.toThrow("requires VERCEL_OIDC_TOKEN");
    await expect(
      fetchSkillsShCatalogPage(
        { page: 0, perPage: 501 },
        { env: { VERCEL_OIDC_TOKEN: "token" }, fetchImpl: vi.fn() },
      ),
    ).rejects.toThrow("perPage must be an integer between 1 and 500");
  });

  it("preserves repository-qualified detail ids", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          id: "anthropics/claude-code/frontend-design",
          source: "anthropics/claude-code",
          slug: "frontend-design",
          installs: 1,
          hash: "hash",
          files: [],
        }),
      );
    });

    await fetchSkillsShCatalogDetail("anthropics/claude-code/frontend-design", {
      env: { VERCEL_OIDC_TOKEN: "token" },
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://skills.sh/api/v1/skills/anthropics/claude-code/frontend-design",
      expect.any(Object),
    );
  });

  it("permits only explicitly enabled permanent Test discovery", () => {
    expect(
      getSkillsShCatalogTestSourcePolicy({
        VERCEL_ENV: "preview",
        VERCEL_OIDC_TOKEN: "token",
        CLAWHUB_SKILLS_SH_TEST_LIVE_FETCH_ENABLED: "1",
      }),
    ).toMatchObject({ allowed: false });

    expect(
      getSkillsShCatalogTestSourcePolicy({
        VERCEL_ENV: "preview",
        VERCEL_TARGET_ENV: "test",
        VITE_CLAWHUB_DEPLOY_ENV: "test",
        VERCEL_OIDC_TOKEN: "token",
        CLAWHUB_SKILLS_SH_TEST_LIVE_FETCH_ENABLED: "1",
      }),
    ).toEqual({
      allowed: true,
      environment: "test",
      maxDiscoveryRows: 500,
      maxRealScanAdmissions: 10,
    });
  });
});
