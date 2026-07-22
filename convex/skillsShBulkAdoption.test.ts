/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const NOW = Date.parse("2026-07-22T20:30:00.000Z");
const LOCAL_ENV = {
  CONVEX_CLOUD_URL: "http://127.0.0.1:3210",
};

type CatalogInput = {
  externalId: string;
  githubOwnerId: number;
  githubCommit?: string;
};

async function insertCatalogEntry(t: ReturnType<typeof convexTest>, input: CatalogInput) {
  const [owner, repo, slug] = input.externalId.split("/");
  return await t.run(async (ctx) => {
    return await ctx.db.insert("skillsShCatalogEntries", {
      externalId: input.externalId,
      sourceKind: "staging-live",
      githubOwnerId: input.githubOwnerId,
      owner: owner!,
      repo: repo!,
      slug: slug!,
      displayName: slug!,
      sourceUrl: `https://skills.sh/${input.externalId}`,
      githubRepoUrl: `https://github.com/${owner}/${repo}`,
      githubPath: `skills/${slug}`,
      githubCommit: input.githubCommit,
      githubContentHash: input.githubCommit ? `github-${slug}` : undefined,
      sourceContentHash: `source-${slug}`,
      installs: 10,
      sourceSnapshotId: "authenticated-snapshot",
      publicVisible: false,
      scanStatus: "not-planned",
      firstObservedAt: NOW,
      lastObservedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

async function insertSkill(
  t: ReturnType<typeof convexTest>,
  input: {
    ownerUserId: Id<"users">;
    ownerPublisherId: Id<"publishers">;
    slug: string;
  },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("skills", {
      slug: input.slug,
      displayName: input.slug,
      ownerUserId: input.ownerUserId,
      ownerPublisherId: input.ownerPublisherId,
      tags: {},
      badges: {},
      moderationStatus: "active",
      latestVersionSummary: {
        version: "1.2.3",
        createdAt: NOW - 1_000,
        changelog: "Current native content",
      },
      statsDownloads: 100,
      statsStars: 4,
      statsInstallsCurrent: 8,
      statsInstallsAllTime: 12,
      stats: {
        downloads: 100,
        stars: 4,
        installsCurrent: 8,
        installsAllTime: 12,
        versions: 3,
        comments: 2,
      },
      createdAt: NOW - 10_000,
      updatedAt: NOW - 1_000,
    });
  });
}

async function createPersonalPublisher(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      handle: "patrick",
      displayName: "Patrick",
      createdAt: NOW - 10_000,
      updatedAt: NOW,
    });
    const publisherId = await ctx.db.insert("publishers", {
      kind: "user",
      handle: "patrick",
      displayName: "Patrick",
      linkedUserId: userId,
      createdAt: NOW - 10_000,
      updatedAt: NOW,
    });
    await ctx.db.insert("publisherMembers", {
      publisherId,
      userId,
      role: "owner",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("authAccounts", {
      userId,
      provider: "github",
      providerAccountId: "1234",
    });
    return { userId, publisherId };
  });
}

function useEnvironment(env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

describe("skills.sh bulk adoption preview query", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("paginates immutable-ID matches and classifies current destinations", async () => {
    useEnvironment(LOCAL_ENV);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const { userId, publisherId } = await createPersonalPublisher(t);
    await insertCatalogEntry(t, {
      externalId: "legacy-login/openclaw/new-skill",
      githubOwnerId: 1_234,
      githubCommit: "commit-new",
    });
    await insertCatalogEntry(t, {
      externalId: "legacy-login/openclaw/discrawl",
      githubOwnerId: 1_234,
      githubCommit: "commit-discrawl",
    });
    await insertCatalogEntry(t, {
      externalId: "legacy-login/openclaw/unavailable",
      githubOwnerId: 1_234,
    });
    await insertCatalogEntry(t, {
      externalId: "legacy-login/openclaw/alias-conflict",
      githubOwnerId: 1_234,
      githubCommit: "commit-alias-conflict",
    });
    await insertCatalogEntry(t, {
      externalId: "same-name-wrong-id/openclaw/ignored",
      githubOwnerId: 9_999,
      githubCommit: "commit-ignored",
    });
    await insertSkill(t, {
      ownerUserId: userId,
      ownerPublisherId: publisherId,
      slug: "discrawl",
    });
    const aliasedSkillId = await insertSkill(t, {
      ownerUserId: userId,
      ownerPublisherId: publisherId,
      slug: "canonical-skill",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("skillSlugAliases", {
        slug: "alias-conflict",
        skillId: aliasedSkillId,
        ownerUserId: userId,
        ownerPublisherId: publisherId,
        createdAt: NOW,
        updatedAt: NOW,
      });
    });

    const authenticated = t.withIdentity({ subject: userId });
    const firstPage = await authenticated.query(api.skillsShBulkAdoption.previewPublisherEntries, {
      publisherId,
      paginationOpts: { cursor: null, numItems: 2 },
    });
    const secondPage = await authenticated.query(api.skillsShBulkAdoption.previewPublisherEntries, {
      publisherId,
      paginationOpts: {
        cursor: firstPage.continueCursor,
        numItems: 2,
      },
    });

    expect(firstPage).toMatchObject({
      publisher: {
        _id: publisherId,
        handle: "patrick",
        kind: "user",
      },
      ownership: {
        kind: "personal",
        githubOwnerId: 1_234,
      },
      catalogSourceKind: "staging-live",
      isDone: false,
    });
    expect(secondPage.isDone).toBe(true);
    expect([...firstPage.page, ...secondPage.page]).toEqual([
      expect.objectContaining({
        publisherId,
        externalId: "legacy-login/openclaw/new-skill",
        classification: "new-destination",
        eligible: true,
      }),
      expect.objectContaining({
        publisherId,
        externalId: "legacy-login/openclaw/discrawl",
        classification: "replacement",
        eligible: true,
        destination: expect.objectContaining({
          skillId: expect.any(String),
          activeVersion: "1.2.3",
        }),
      }),
      expect.objectContaining({
        publisherId,
        externalId: "legacy-login/openclaw/unavailable",
        classification: "unavailable",
        eligible: false,
        reason: "missing-exact-source",
      }),
      expect.objectContaining({
        publisherId,
        externalId: "legacy-login/openclaw/alias-conflict",
        classification: "ownership-conflict",
        eligible: false,
        reason: "destination-alias-conflict",
      }),
    ]);
  });

  it("requires fresh GitHub organization admin proof for redirected owner logins", async () => {
    useEnvironment(LOCAL_ENV);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const { userId, publisherId, githubMembershipId } = await t.run(async (ctx) => {
      const actorUserId = await ctx.db.insert("users", {
        handle: "org-admin",
        displayName: "Org Admin",
        githubOrgMembershipsSyncedAt: NOW,
        createdAt: NOW - 10_000,
        updatedAt: NOW,
      });
      const orgPublisherId = await ctx.db.insert("publishers", {
        kind: "org",
        handle: "openclaw",
        displayName: "OpenClaw",
        githubHandle: "openclaw",
        githubOrgId: "4242",
        githubVerifiedAt: NOW - 5_000,
        githubVerifiedByUserId: actorUserId,
        createdAt: NOW - 10_000,
        updatedAt: NOW,
      });
      await ctx.db.insert("publisherMembers", {
        publisherId: orgPublisherId,
        userId: actorUserId,
        role: "admin",
        createdAt: NOW,
        updatedAt: NOW,
      });
      const orgMembershipId = await ctx.db.insert("githubOrgMemberships", {
        userId: actorUserId,
        githubOrgId: "4242",
        login: "openclaw",
        role: "admin",
        syncedAt: NOW,
      });
      return {
        userId: actorUserId,
        publisherId: orgPublisherId,
        githubMembershipId: orgMembershipId,
      };
    });
    await insertCatalogEntry(t, {
      externalId: "steipete/clawdis/discrawl",
      githubOwnerId: 4_242,
      githubCommit: "canonical-redirect-commit",
    });

    const authenticated = t.withIdentity({ subject: userId });
    const result = await authenticated.query(api.skillsShBulkAdoption.previewPublisherEntries, {
      publisherId,
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(result).toMatchObject({
      ownership: {
        kind: "organization",
        githubOwnerId: 4_242,
        githubLogin: "openclaw",
      },
      page: [
        expect.objectContaining({
          externalId: "steipete/clawdis/discrawl",
          eligible: true,
        }),
      ],
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(githubMembershipId, { role: "member" });
    });
    await expect(
      authenticated.query(api.skillsShBulkAdoption.previewPublisherEntries, {
        publisherId,
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    ).rejects.toThrow("Reconnect GitHub to verify current organization admin access");
  });

  it("does not use another member's GitHub identity for a personal publisher", async () => {
    useEnvironment(LOCAL_ENV);
    const t = convexTest(schema, modules);
    const { publisherId } = await createPersonalPublisher(t);
    const otherUserId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        handle: "other-admin",
        displayName: "Other Admin",
        createdAt: NOW,
        updatedAt: NOW,
      });
      await ctx.db.insert("publisherMembers", {
        publisherId,
        userId,
        role: "admin",
        createdAt: NOW,
        updatedAt: NOW,
      });
      await ctx.db.insert("authAccounts", {
        userId,
        provider: "github",
        providerAccountId: "1234",
      });
      return userId;
    });

    await expect(
      t
        .withIdentity({ subject: otherUserId })
        .query(api.skillsShBulkAdoption.previewPublisherEntries, {
          publisherId,
          paginationOpts: { cursor: null, numItems: 10 },
        }),
    ).rejects.toThrow("Forbidden");
  });

  it("rejects unbounded preview pages", async () => {
    useEnvironment(LOCAL_ENV);
    const t = convexTest(schema, modules);
    const { userId, publisherId } = await createPersonalPublisher(t);

    await expect(
      t.withIdentity({ subject: userId }).query(api.skillsShBulkAdoption.previewPublisherEntries, {
        publisherId,
        paginationOpts: { cursor: null, numItems: 101 },
      }),
    ).rejects.toThrow("numItems must be an integer between 1 and 100");
  });
});
