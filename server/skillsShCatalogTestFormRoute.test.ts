/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";

const sourcePolicyMock = vi.fn();

vi.mock("./skillsShCatalogSource", () => ({
  getSkillsShCatalogTestSourcePolicy: (...args: unknown[]) => sourcePolicyMock(...args),
}));

describe("skills.sh permanent Test operator form", () => {
  beforeEach(() => {
    sourcePolicyMock.mockReset();
  });

  it("serves only the exact Test gate and keeps the token out of the document", async () => {
    sourcePolicyMock.mockReturnValue({ allowed: true, environment: "test" });
    const handler = (await import("./routes/ops/skills-sh/catalog-test.get")).default;
    const response = (await handler({} as never)) as Response;
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('type="password"');
    expect(body).toContain('"Authorization": authorization');
    expect(body).not.toContain("VERCEL_OIDC_TOKEN");
  });

  it("is a hard 404 when the live Test source marker is disabled", async () => {
    sourcePolicyMock.mockReturnValue({ allowed: false, environment: "test" });
    const handler = (await import("./routes/ops/skills-sh/catalog-test.get")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(404);
  });
});
