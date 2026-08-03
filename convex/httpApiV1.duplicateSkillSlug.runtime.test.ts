/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedSamePublisherDuplicates() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", {
      handle: "duplicate-owner",
      displayName: "Duplicate Owner",
    });
    const ownerPublisherId = await ctx.db.insert("publishers", {
      kind: "user",
      handle: "duplicate-owner",
      displayName: "Duplicate Owner",
      linkedUserId: ownerUserId,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.patch(ownerUserId, { personalPublisherId: ownerPublisherId });

    const insertSkill = async (version: string, publishedAt: number) => {
      const skillId = await ctx.db.insert("skills", {
        slug: "duplicate-skill",
        displayName: `Duplicate Skill ${version}`,
        ownerUserId,
        ownerPublisherId,
        tags: {},
        badges: {},
        moderationStatus: "active",
        stats: { comments: 0, downloads: 0, stars: 0, versions: 1 },
        createdAt: publishedAt,
        updatedAt: publishedAt,
      });
      const versionId = await ctx.db.insert("skillVersions", {
        skillId,
        version,
        changelog: "",
        files: [],
        parsed: { frontmatter: {} },
        createdBy: ownerUserId,
        createdAt: publishedAt,
      });
      await ctx.db.patch(skillId, {
        latestVersionId: versionId,
        latestVersionSummary: { version, createdAt: publishedAt, changelog: "" },
        tags: { latest: versionId },
      });
    };

    await insertSkill("1.0.0", 1);
    await insertSkill("2.0.0", 2);
  });
  return t;
}

async function expectNewestVersion(response: Response) {
  expect(response.status).toBe(200);
  const body = (await response.json()) as { items: Array<{ version: string }> };
  expect(body.items.map((item) => item.version)).toEqual(["2.0.0"]);
}

describe("duplicate skill slug runtime resolution", () => {
  it("serves the newest same-publisher skill from the bare versions endpoint", async () => {
    const t = await seedSamePublisherDuplicates();

    await expectNewestVersion(await t.fetch("/api/v1/skills/duplicate-skill/versions"));
  });

  it("serves the newest same-publisher skill from the owner-qualified versions endpoint", async () => {
    const t = await seedSamePublisherDuplicates();

    await expectNewestVersion(
      await t.fetch("/api/v1/skills/duplicate-skill/versions?ownerHandle=duplicate-owner"),
    );
  });
});
