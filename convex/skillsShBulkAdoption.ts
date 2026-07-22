import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { query } from "./functions";
import { requireUser } from "./lib/access";
import { getGitHubProviderAccountId } from "./lib/githubIdentity";
import { GITHUB_ORG_MEMBERSHIP_VERIFICATION_MAX_AGE_MS } from "./lib/githubOrgMemberships";
import { requirePublisherRole } from "./lib/publishers";
import {
  getSkillBySlugForPublisher,
  getSkillSlugAliasBySlugForPublisher,
} from "./lib/skills/slugResolution";
import {
  buildBulkAdoptionPreviewItem,
  type BulkAdoptionDestination,
} from "./lib/skillsShBulkAdoption";
import { assertSkillsShFixtureEnvironmentAllowed } from "./lib/skillsShCatalogEnvironment";

const MAX_PREVIEW_PAGE_SIZE = 100;

function parseGitHubOwnerId(value: string | undefined, error: string) {
  if (!value || !/^[1-9]\d*$/.test(value)) throw new ConvexError(error);
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw new ConvexError(error);
  return id;
}

async function getVerifiedPublisherOwnership(
  ctx: QueryCtx,
  publisher: Doc<"publishers">,
  userId: Doc<"users">["_id"],
) {
  if (publisher.kind === "user") {
    if (publisher.linkedUserId !== userId) throw new ConvexError("Forbidden");
    const providerAccountId = await getGitHubProviderAccountId(ctx, userId);
    return {
      kind: "personal" as const,
      githubOwnerId: parseGitHubOwnerId(
        providerAccountId ?? undefined,
        "Reconnect GitHub to verify your personal account",
      ),
    };
  }

  const githubOwnerId = parseGitHubOwnerId(
    publisher.githubOrgId,
    "Connect a verified GitHub organization to this publisher",
  );
  if (!publisher.githubVerifiedAt) {
    throw new ConvexError("Connect a verified GitHub organization to this publisher");
  }
  const membership = await ctx.db
    .query("githubOrgMemberships")
    .withIndex("by_user_and_github_org", (q) =>
      q.eq("userId", userId).eq("githubOrgId", String(githubOwnerId)),
    )
    .unique();
  if (
    !membership ||
    membership.role !== "admin" ||
    Date.now() - membership.syncedAt > GITHUB_ORG_MEMBERSHIP_VERIFICATION_MAX_AGE_MS
  ) {
    throw new ConvexError("Reconnect GitHub to verify current organization admin access");
  }
  return {
    kind: "organization" as const,
    githubOwnerId,
    githubLogin: membership.login,
    verifiedAt: publisher.githubVerifiedAt,
    membershipSyncedAt: membership.syncedAt,
  };
}

async function resolveDestination(
  ctx: QueryCtx,
  publisher: Doc<"publishers">,
  entry: Doc<"skillsShCatalogEntries">,
): Promise<BulkAdoptionDestination> {
  const [skill, alias] = await Promise.all([
    getSkillBySlugForPublisher(ctx, entry.slug, publisher),
    getSkillSlugAliasBySlugForPublisher(ctx, entry.slug, publisher),
  ]);
  if (alias && (!skill || alias.skillId !== skill._id)) {
    const aliasedSkill = await ctx.db.get(alias.skillId);
    return {
      kind: "alias",
      skillId: alias.skillId,
      ownerPublisherId: publisher._id,
      ownerHandle: publisher.handle,
      slug: entry.slug,
      displayName: aliasedSkill?.displayName ?? entry.slug,
    };
  }
  if (skill) {
    return {
      kind: "owned",
      skillId: skill._id,
      ownerPublisherId: publisher._id,
      ownerHandle: publisher.handle,
      slug: skill.slug,
      displayName: skill.displayName,
      activeVersion: skill.latestVersionSummary?.version,
      unavailableReason: skill.softDeletedAt ? "destination-soft-deleted" : undefined,
    };
  }
  return { kind: "none" };
}

export const previewPublisherEntries = query({
  args: {
    publisherId: v.id("publishers"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    assertSkillsShFixtureEnvironmentAllowed();
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > MAX_PREVIEW_PAGE_SIZE
    ) {
      throw new ConvexError(`numItems must be an integer between 1 and ${MAX_PREVIEW_PAGE_SIZE}`);
    }
    const { userId } = await requireUser(ctx);
    const { publisher } = await requirePublisherRole(ctx, {
      publisherId: args.publisherId,
      userId,
      allowed: ["admin"],
    });
    const ownership = await getVerifiedPublisherOwnership(ctx, publisher, userId);
    const entries = await ctx.db
      .query("skillsShCatalogEntries")
      .withIndex("by_source_kind_and_github_owner_id_and_owner", (q) =>
        q.eq("sourceKind", "staging-live").eq("githubOwnerId", ownership.githubOwnerId),
      )
      .paginate(args.paginationOpts);
    const page = await Promise.all(
      entries.page.map(async (entry) =>
        buildBulkAdoptionPreviewItem({
          publisherId: publisher._id,
          entry: {
            externalId: entry.externalId,
            githubOwnerId: entry.githubOwnerId,
            owner: entry.owner,
            repo: entry.repo,
            slug: entry.slug,
            displayName: entry.displayName,
            sourceUrl: entry.sourceUrl,
            githubRepoUrl: entry.githubRepoUrl,
            githubPath: entry.githubPath,
            githubCommit: entry.githubCommit,
            githubContentHash: entry.githubContentHash,
            sourceContentHash: entry.sourceContentHash,
          },
          destination: await resolveDestination(ctx, publisher, entry),
        }),
      ),
    );
    return {
      publisher: {
        _id: publisher._id,
        handle: publisher.handle,
        kind: publisher.kind,
      },
      ownership,
      catalogSourceKind: "staging-live" as const,
      ...entries,
      page,
    };
  },
});
