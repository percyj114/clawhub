import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  prepareDeployConfig,
  renderRobotsTxt,
  renderWellKnownConfig,
  resolvePrepareDeployConfigOptions,
  rewriteVercelJson,
} from "./prepare-deploy-config";

const tempDirs: string[] = [];

function makeTempProject() {
  const rootDir = mkdtempSync(join(tmpdir(), "clawhub-deploy-config-"));
  tempDirs.push(rootDir);
  mkdirSync(join(rootDir, "public", ".well-known"), { recursive: true });
  writeFileSync(
    join(rootDir, "vercel.json"),
    JSON.stringify({
      rewrites: [
        {
          source: "/api/:path*",
          destination: "https://wry-manatee-359.convex.site/api/:path*",
        },
      ],
    }),
  );
  writeFileSync(join(rootDir, "public", ".well-known", "clawhub.json"), "{}\n");
  writeFileSync(join(rootDir, "public", ".well-known", "clawdhub.json"), "{}\n");
  writeFileSync(join(rootDir, "public", "robots.txt"), "User-agent: *\nDisallow:\n");
  return rootDir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("prepare deploy config", () => {
  it("rewrites the Vercel API proxy to the selected Convex site URL", () => {
    const result = rewriteVercelJson(
      JSON.stringify({
        headers: [],
        rewrites: [{ source: "/api/:path*", destination: "https://prod.convex.site/api/:path*" }],
      }),
      "https://staging.convex.site/path-is-ignored",
    );

    expect(JSON.parse(result).rewrites).toEqual([
      {
        source: "/api/:path*",
        destination: "https://staging.convex.site/api/:path*",
      },
    ]);
  });

  it("renders well-known discovery against the public site origin", () => {
    expect(
      JSON.parse(
        renderWellKnownConfig({
          siteUrl: "https://staging.hub.openclaw.ai/some/path",
          minCliVersion: "0.1.0",
        }),
      ),
    ).toEqual({
      apiBase: "https://staging.hub.openclaw.ai",
      authBase: "https://staging.hub.openclaw.ai",
      minCliVersion: "0.1.0",
      registry: "https://staging.hub.openclaw.ai",
    });
  });

  it("blocks indexing for staging robots.txt", () => {
    expect(renderRobotsTxt("staging")).toContain("Disallow: /");
    expect(renderRobotsTxt("production")).toContain("Disallow:\n");
  });

  it("updates all deploy-time config files for staging", () => {
    const rootDir = makeTempProject();

    prepareDeployConfig({
      rootDir,
      target: "staging",
      siteUrl: "https://staging.hub.openclaw.ai",
      convexSiteUrl: "https://staging.convex.site",
      minCliVersion: "0.1.0",
    });

    const vercelConfig = JSON.parse(readFileSync(join(rootDir, "vercel.json"), "utf8"));
    expect(vercelConfig.rewrites[0].destination).toBe("https://staging.convex.site/api/:path*");

    const wellKnown = JSON.parse(
      readFileSync(join(rootDir, "public", ".well-known", "clawhub.json"), "utf8"),
    );
    expect(wellKnown.apiBase).toBe("https://staging.hub.openclaw.ai");
    expect(readFileSync(join(rootDir, "public", "robots.txt"), "utf8")).toContain("Disallow: /");
  });

  it("resolves staging defaults from explicit environment values", () => {
    expect(
      resolvePrepareDeployConfigOptions([], {
        DEPLOY_TARGET: "staging",
        STAGING_CONVEX_SITE_URL: "https://staging.convex.site",
      }).siteUrl,
    ).toBe("https://staging.hub.openclaw.ai");
  });
});
