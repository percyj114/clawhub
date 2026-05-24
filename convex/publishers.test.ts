import { getAuthUserId } from "@convex-dev/auth/server";
import { describe, expect, it, vi } from "vitest";
import { assertCanManageOwnedResource } from "./lib/publishers";
import {
  addMember,
  listPublicPage,
  listPublic,
  listMine,
  listPublishedPage,
  migrateLegacyPublisherHandleToOrgInternal,
  ensureOrgPublisherHandleInternal,
  createOrg,
  removeMember,
  createOrgPublisherForUserInternal,
  setOfficialPublisher,
  syncPublisherPackageOfficialStateBatchInternal,
  syncPublisherSkillOfficialStateBatchInternal,
  setTrustedPublisherInternal,
  updateProfile,
} from "./publishers";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
}));

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const addMemberHandler = (
  addMember as unknown as WrappedHandler<{
    publisherId: string;
    userHandle: string;
    role: "owner" | "admin" | "publisher";
  }>
)._handler;

const removeMemberHandler = (
  removeMember as unknown as WrappedHandler<{ publisherId: string; userId: string }>
)._handler;

const migrateLegacyPublisherHandleToOrgInternalHandler = (
  migrateLegacyPublisherHandleToOrgInternal as unknown as WrappedHandler<
    {
      actorUserId: string;
      handle: string;
      fallbackUserHandle?: string;
      displayName?: string;
    },
    {
      ok: true;
      handle: string;
      orgPublisherId: string;
      legacyUserId: string;
      fallbackUserHandle: string;
      personalPublisherId: string | null;
      convertedExistingPublisher: boolean;
      packagesMigrated: number;
    }
  >
)._handler;

const ensureOrgPublisherHandleInternalHandler = (
  ensureOrgPublisherHandleInternal as unknown as WrappedHandler<
    {
      actorUserId: string;
      handle: string;
      displayName?: string;
      memberHandle?: string;
      memberRole?: "owner" | "admin" | "publisher";
    },
    {
      ok: true;
      publisherId: string;
      handle: string;
      created: boolean;
      member?: { userId: string; handle: string; role: "owner" | "admin" | "publisher" };
    }
  >
)._handler;

const listMineHandler = (
  listMine as unknown as WrappedHandler<Record<string, never>, Array<unknown>>
)._handler;

const listPublicHandler = (
  listPublic as unknown as WrappedHandler<
    { limit?: number; kind?: "user" | "org" },
    {
      items: Array<{ handle: string; kind: "user" | "org"; stats: { downloads: number } }>;
      total: number;
      counts: { all: number; individuals: number; organizations: number };
      limit: number;
    }
  >
)._handler;

const listPublicPageHandler = (
  listPublicPage as unknown as WrappedHandler<
    {
      kind?: "user" | "org";
      query?: string;
      paginationOpts: { cursor: string | null; numItems: number };
    },
    {
      page: Array<{
        handle: string;
        kind: "user" | "org";
        stats: { downloads: number };
        publishedItems: Array<{ displayName: string; downloads: number }>;
      }>;
      counts: { all: number; individuals: number; organizations: number };
      globalCounts: { all: number; individuals: number; organizations: number };
      continueCursor: string;
      isDone: boolean;
    }
  >
)._handler;

const listPublishedPageHandler = (
  listPublishedPage as unknown as WrappedHandler<
    {
      handle: string;
      paginationOpts: { cursor: string | null; numItems: number };
    },
    {
      page: Array<{ displayName: string; href: string }>;
      continueCursor: string;
      isDone: boolean;
    }
  >
)._handler;

const setOfficialPublisherHandler = (
  setOfficialPublisher as unknown as WrappedHandler<
    { handle: string; official: boolean },
    {
      ok: true;
      publisher: { handle: string; official: boolean } | null;
      skillSync: { updatedSkills: number; skillSyncTruncated: boolean };
      packageSync: { updatedPackages: number; packageSyncTruncated: boolean };
    }
  >
)._handler;

const syncPublisherPackageOfficialStateBatchInternalHandler = (
  syncPublisherPackageOfficialStateBatchInternal as unknown as WrappedHandler<
    {
      publisherId: string;
      official: boolean;
      officialAt?: number;
      now: number;
      phase: "scoped" | "legacy";
      cursor?: string | null;
    },
    { updatedPackages: number; packageSyncTruncated: boolean }
  >
)._handler;

const syncPublisherSkillOfficialStateBatchInternalHandler = (
  syncPublisherSkillOfficialStateBatchInternal as unknown as WrappedHandler<
    {
      publisherId: string;
      official: boolean;
      officialBadge?: { byUserId: string; at: number; sourcePublisherId?: string };
      now: number;
      phase: "scoped" | "legacy";
      cursor?: string | null;
    },
    { updatedSkills: number; skillSyncTruncated: boolean }
  >
)._handler;

const updateProfileHandler = (
  updateProfile as unknown as WrappedHandler<{
    publisherId: string;
    displayName: string;
    bio?: string;
    image?: string;
  }>
)._handler;

const setTrustedPublisherInternalHandler = (
  setTrustedPublisherInternal as unknown as WrappedHandler<{
    actorUserId: string;
    publisherId: string;
    trustedPublisher: boolean;
  }>
)._handler;

const createOrgPublisherForUserInternalHandler = (
  createOrgPublisherForUserInternal as unknown as WrappedHandler<
    {
      actorUserId: string;
      handle: string;
      displayName?: string;
    },
    {
      ok: true;
      publisherId: string;
      handle: string;
      created: true;
      trusted: false;
    }
  >
)._handler;

const createOrgHandler = (
  createOrg as unknown as WrappedHandler<
    {
      handle: string;
      displayName: string;
      bio?: string;
    },
    {
      publisher: { handle: string; bio?: string };
      role: "owner";
    }
  >
)._handler;

function indexedRows<T>(rows: T[]) {
  return {
    collect: vi.fn(async () => rows),
    take: vi.fn(async (limit: number) => rows.slice(0, limit)),
    paginate: vi.fn(async ({ cursor, numItems }: { cursor: string | null; numItems: number }) => {
      const offset = cursor ? Number(cursor) : 0;
      const nextOffset = offset + numItems;
      const isDone = nextOffset >= rows.length;
      return {
        page: rows.slice(offset, nextOffset),
        continueCursor: isDone ? "" : String(nextOffset),
        isDone,
      };
    }),
    order: vi.fn(() => ({ take: vi.fn(async (limit: number) => rows.slice(0, limit)) })),
  };
}

describe("publishers membership controls", () => {
  it("rejects org handles reserved for public routes", async () => {
    const ctx = {
      db: {
        get: vi.fn(async (id: string) =>
          id === "users:admin" ? { _id: id, role: "admin" } : null,
        ),
        query: vi.fn(),
        insert: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    await expect(
      migrateLegacyPublisherHandleToOrgInternalHandler(ctx, {
        actorUserId: "users:admin",
        handle: "skills",
      }),
    ).rejects.toThrow('Handle "@skills" is reserved for ClawHub routes');
  });

  it("lists individual and org publishers ranked by aggregate downloads", async () => {
    const publisherRows = [
      {
        _id: "publishers:alice",
        _creationTime: 1,
        kind: "user",
        handle: "alice",
        displayName: "Alice",
        linkedUserId: "users:alice",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        _id: "publishers:openclaw",
        _creationTime: 1,
        kind: "org",
        handle: "openclaw",
        displayName: "OpenClaw",
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const skillRows = [
      {
        _id: "skills:alice",
        ownerPublisherId: "publishers:alice",
        softDeletedAt: undefined,
        statsDownloads: 4,
        statsStars: 1,
        statsInstallsAllTime: 3,
        stats: { downloads: 4, stars: 1, installsCurrent: 1, installsAllTime: 3 },
      },
      {
        _id: "skills:openclaw",
        ownerPublisherId: "publishers:openclaw",
        softDeletedAt: undefined,
        statsDownloads: 20,
        statsStars: 2,
        statsInstallsAllTime: 15,
        stats: { downloads: 20, stars: 2, installsCurrent: 4, installsAllTime: 15 },
      },
    ];
    const packageRows = [
      {
        _id: "packages:alice",
        ownerPublisherId: "publishers:alice",
        softDeletedAt: undefined,
        stats: { downloads: 5, stars: 0, installs: 2, versions: 1 },
      },
    ];

    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:alice") return { _id: id, image: "https://github.com/alice.png" };
          return null;
        }),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string, buildQuery: (q: unknown) => unknown) => {
            const fields: Record<string, unknown> = {};
            const q = {
              eq: (field: string, value: unknown) => {
                fields[field] = value;
                return q;
              },
            };
            buildQuery(q);
            if (table === "publishers" && indexName === "by_active_total_downloads") {
              return {
                order: vi.fn(() => ({ collect: vi.fn(async () => publisherRows) })),
              };
            }
            if (table === "skills" && indexName === "by_owner_publisher_active_updated") {
              return indexedRows(
                skillRows.filter((skill) => skill.ownerPublisherId === fields.ownerPublisherId),
              );
            }
            if (table === "packages" && indexName === "by_owner_publisher_active_updated") {
              return indexedRows(
                packageRows.filter((pkg) => pkg.ownerPublisherId === fields.ownerPublisherId),
              );
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    const result = await listPublicHandler(ctx as never, { limit: 48 });

    expect(result.total).toBe(2);
    expect(result.counts).toEqual({ all: 2, individuals: 1, organizations: 1 });
    expect(result.items.map((item) => item.handle)).toEqual(["openclaw", "alice"]);
    expect(result.items.map((item) => item.kind)).toEqual(["org", "user"]);
    expect(result.items.map((item) => item.stats.downloads)).toEqual([20, 9]);
  });

  it("filters public publisher listings by kind", async () => {
    const publisherRows = [
      {
        _id: "publishers:alice",
        _creationTime: 1,
        kind: "user",
        handle: "alice",
        displayName: "Alice",
        linkedUserId: "users:alice",
        publishedSkills: 1,
        publishedPackages: 0,
        totalInstalls: 4,
        totalDownloads: 10,
        totalStars: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        _id: "publishers:openclaw",
        _creationTime: 1,
        kind: "org",
        handle: "openclaw",
        displayName: "OpenClaw",
        publishedSkills: 0,
        publishedPackages: 1,
        totalInstalls: 20,
        totalDownloads: 40,
        totalStars: 2,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:alice") return { _id: id, image: "https://github.com/alice.png" };
          return null;
        }),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string, buildQuery: (q: unknown) => unknown) => {
            const fields: Record<string, unknown> = {};
            const q = {
              eq: (field: string, value: unknown) => {
                fields[field] = value;
                return q;
              },
            };
            buildQuery(q);
            if (table === "publishers" && indexName === "by_active_total_downloads") {
              return {
                order: vi.fn(() => ({ collect: vi.fn(async () => publisherRows) })),
              };
            }
            if (
              (table === "skills" || table === "packages") &&
              indexName === "by_owner_publisher_active_downloads"
            ) {
              return indexedRows([]);
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    const result = await listPublicHandler(ctx as never, { kind: "org" });

    expect(result.total).toBe(1);
    expect(result.counts).toEqual({ all: 2, individuals: 1, organizations: 1 });
    expect(result.items.map((item) => item.handle)).toEqual(["openclaw"]);
  });

  it("pages public publishers by kind and query", async () => {
    const publisherRows = [
      {
        _id: "publishers:alice",
        _creationTime: 1,
        kind: "user",
        handle: "alice",
        displayName: "Alice Labs",
        linkedUserId: "users:alice",
        publishedSkills: 1,
        publishedPackages: 0,
        totalInstalls: 4,
        totalDownloads: 10,
        totalStars: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        _id: "publishers:bob",
        _creationTime: 1,
        kind: "user",
        handle: "bob",
        displayName: "Bob Tools",
        linkedUserId: "users:bob",
        publishedSkills: 1,
        publishedPackages: 0,
        totalInstalls: 2,
        totalDownloads: 8,
        totalStars: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        _id: "publishers:openclaw",
        _creationTime: 1,
        kind: "org",
        handle: "openclaw",
        displayName: "OpenClaw",
        publishedSkills: 0,
        publishedPackages: 1,
        totalInstalls: 20,
        totalDownloads: 40,
        totalStars: 2,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:alice") return { _id: id, image: "https://github.com/alice.png" };
          if (id === "users:bob") return { _id: id, image: "https://github.com/bob.png" };
          return null;
        }),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string, buildQuery: (q: unknown) => unknown) => {
            const fields: Record<string, unknown> = {};
            const q = {
              eq: (field: string, value: unknown) => {
                fields[field] = value;
                return q;
              },
            };
            buildQuery(q);
            if (table === "publishers" && indexName === "by_active_kind_total_downloads") {
              return {
                order: vi.fn(() => ({
                  take: vi.fn(async () =>
                    publisherRows.filter((publisher) => publisher.kind === fields.kind),
                  ),
                })),
              };
            }
            if (table === "publishers" && indexName === "by_active_total_downloads") {
              return {
                order: vi.fn(() => ({
                  take: vi.fn(async () => publisherRows),
                })),
              };
            }
            if (table === "publishers" && indexName === "by_active_kind_handle") {
              return {
                collect: vi.fn(async () =>
                  publisherRows.filter((publisher) => publisher.kind === fields.kind),
                ),
              };
            }
            if (
              (table === "skills" || table === "packages") &&
              indexName === "by_owner_publisher_active_downloads"
            ) {
              return indexedRows([]);
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    const result = await listPublicPageHandler(ctx as never, {
      kind: "user",
      query: "alice",
      paginationOpts: { cursor: null, numItems: 25 },
    });

    expect(result.counts).toEqual({ all: 1, individuals: 1, organizations: 0 });
    expect(result.globalCounts).toEqual({ all: 3, individuals: 2, organizations: 1 });
    expect(result.page.map((item) => item.handle)).toEqual(["alice"]);
  });

  it("orders public publisher card previews by downloads", async () => {
    const publisherRows = [
      {
        _id: "publishers:openclaw",
        _creationTime: 1,
        kind: "org",
        handle: "openclaw",
        displayName: "OpenClaw",
        publishedSkills: 1,
        publishedPackages: 4,
        totalInstalls: 20,
        totalDownloads: 364,
        totalStars: 2,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const skillRows = [
      {
        _id: "skills:popular-skill",
        ownerPublisherId: "publishers:openclaw",
        softDeletedAt: undefined,
        displayName: "Popular Skill",
        statsDownloads: 98,
        statsStars: 1,
        statsInstallsAllTime: 1,
        stats: { downloads: 98, stars: 1, installsCurrent: 1, installsAllTime: 1 },
        updatedAt: 1,
      },
    ];
    const packageRows = [
      {
        _id: "packages:popular-plugin",
        ownerPublisherId: "publishers:openclaw",
        softDeletedAt: undefined,
        family: "code-plugin",
        displayName: "Popular Plugin",
        stats: { downloads: 128, stars: 1, installs: 1, versions: 1 },
        updatedAt: 1,
      },
      {
        _id: "packages:recent-plugin",
        ownerPublisherId: "publishers:openclaw",
        softDeletedAt: undefined,
        family: "code-plugin",
        displayName: "Recent Plugin",
        stats: { downloads: 12, stars: 1, installs: 1, versions: 1 },
        updatedAt: 5,
      },
      {
        _id: "packages:recent-helper",
        ownerPublisherId: "publishers:openclaw",
        softDeletedAt: undefined,
        family: "code-plugin",
        displayName: "Recent Helper",
        stats: { downloads: 11, stars: 1, installs: 1, versions: 1 },
        updatedAt: 4,
      },
      {
        _id: "packages:recent-tool",
        ownerPublisherId: "publishers:openclaw",
        softDeletedAt: undefined,
        family: "code-plugin",
        displayName: "Recent Tool",
        stats: { downloads: 10, stars: 1, installs: 1, versions: 1 },
        updatedAt: 3,
      },
    ];
    const rowsByDownloads = <
      T extends { updatedAt: number; stats?: { downloads: number }; statsDownloads?: number },
    >(
      rows: T[],
    ) =>
      [...rows].sort(
        (a, b) =>
          (b.statsDownloads ?? b.stats?.downloads ?? 0) -
            (a.statsDownloads ?? a.stats?.downloads ?? 0) || b.updatedAt - a.updatedAt,
      );
    const ctx = {
      db: {
        get: vi.fn(),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string, buildQuery: (q: unknown) => unknown) => {
            const fields: Record<string, unknown> = {};
            const q = {
              eq: (field: string, value: unknown) => {
                fields[field] = value;
                return q;
              },
            };
            buildQuery(q);
            if (table === "publishers" && indexName === "by_active_total_downloads") {
              return {
                order: vi.fn(() => ({
                  take: vi.fn(async () => publisherRows),
                })),
              };
            }
            if (table === "skills" && indexName === "by_owner_publisher_active_downloads") {
              return indexedRows(
                rowsByDownloads(
                  skillRows.filter((skill) => skill.ownerPublisherId === fields.ownerPublisherId),
                ),
              );
            }
            if (table === "packages" && indexName === "by_owner_publisher_active_downloads") {
              return indexedRows(
                rowsByDownloads(
                  packageRows.filter((pkg) => pkg.ownerPublisherId === fields.ownerPublisherId),
                ),
              );
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    const result = await listPublicPageHandler(ctx as never, {
      paginationOpts: { cursor: null, numItems: 25 },
    });

    expect(result.page[0]?.publishedItems.map((item) => item.displayName)).toEqual([
      "Popular Plugin",
      "Popular Skill",
      "Recent Plugin",
    ]);
    expect(result.page[0]?.publishedItems.map((item) => item.downloads)).toEqual([128, 98, 12]);
  });

  it("does not hydrate every publisher before filtering public publisher pages", async () => {
    const publisherRows = Array.from({ length: 120 }, (_, index) => ({
      _id: `publishers:user-${index}`,
      _creationTime: index,
      kind: "user",
      handle: `user-${index}`,
      displayName: `User ${index}`,
      linkedUserId: `users:user-${index}`,
      publishedSkills: 1,
      publishedPackages: 0,
      totalInstalls: 120 - index,
      totalDownloads: 120 - index,
      totalStars: 1,
      createdAt: 1,
      updatedAt: 1,
    }));
    const get = vi.fn(async (id: string) => ({ _id: id, image: `https://github.com/${id}.png` }));
    const ownerPublisherQueries: string[] = [];
    const ctx = {
      db: {
        get,
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string, buildQuery: (q: unknown) => unknown) => {
            const fields: Record<string, unknown> = {};
            const q = {
              eq: (field: string, value: unknown) => {
                fields[field] = value;
                return q;
              },
            };
            buildQuery(q);
            if (table === "publishers" && indexName === "by_active_total_downloads") {
              return {
                order: vi.fn(() => ({
                  take: vi.fn(async () => publisherRows),
                })),
              };
            }
            if (
              (table === "skills" || table === "packages") &&
              indexName === "by_owner_publisher_active_downloads"
            ) {
              ownerPublisherQueries.push(String(fields.ownerPublisherId));
              return indexedRows([]);
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    const result = await listPublicPageHandler(ctx as never, {
      paginationOpts: { cursor: null, numItems: 1 },
    });

    expect(result.page.map((item) => item.handle)).toEqual(["user-0"]);
    expect(result.globalCounts).toEqual({ all: 120, individuals: 120, organizations: 0 });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("users:user-0");
    expect(ownerPublisherQueries).toEqual(["publishers:user-0", "publishers:user-0"]);
  });

  it("does not hydrate publishers when a public publisher search has no matches", async () => {
    const publisherRows = Array.from({ length: 120 }, (_, index) => ({
      _id: `publishers:user-${index}`,
      _creationTime: index,
      kind: "user",
      handle: `user-${index}`,
      displayName: `User ${index}`,
      linkedUserId: `users:user-${index}`,
      publishedSkills: 1,
      publishedPackages: 0,
      totalInstalls: 120 - index,
      totalDownloads: 120 - index,
      totalStars: 1,
      createdAt: 1,
      updatedAt: 1,
    }));
    const get = vi.fn();
    const ctx = {
      db: {
        get,
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string, buildQuery: (q: unknown) => unknown) => {
            const q = {
              eq: () => q,
            };
            buildQuery(q);
            if (table === "publishers" && indexName === "by_active_total_downloads") {
              return {
                order: vi.fn(() => ({
                  take: vi.fn(async () => publisherRows),
                })),
              };
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    const result = await listPublicPageHandler(ctx as never, {
      query: "no matching publisher",
      paginationOpts: { cursor: null, numItems: 25 },
    });

    expect(result.page).toEqual([]);
    expect(result.counts).toEqual({ all: 0, individuals: 0, organizations: 0 });
    expect(result.globalCounts).toEqual({ all: 120, individuals: 120, organizations: 0 });
    expect(get).not.toHaveBeenCalled();
  });

  it("builds scoped plugin profile links with route segments", async () => {
    const publisher = {
      _id: "publishers:openclaw",
      _creationTime: 1,
      kind: "org",
      handle: "openclaw",
      displayName: "OpenClaw",
      createdAt: 1,
      updatedAt: 1,
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => (id === "publishers:openclaw" ? publisher : null)),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string, buildQuery: (q: unknown) => unknown) => {
            const fields: Record<string, unknown> = {};
            const q = {
              eq: (field: string, value: unknown) => {
                fields[field] = value;
                return q;
              },
            };
            buildQuery(q);
            if (table === "publishers" && indexName === "by_handle") {
              return {
                unique: vi.fn(async () => (fields.handle === "openclaw" ? publisher : null)),
              };
            }
            if (table === "skills" && indexName === "by_owner_publisher_active_updated") {
              return indexedRows([]);
            }
            if (table === "packages" && indexName === "by_owner_publisher_active_updated") {
              return indexedRows([
                {
                  _id: "packages:plugin",
                  ownerPublisherId: "publishers:openclaw",
                  softDeletedAt: undefined,
                  family: "code-plugin",
                  name: "@openclaw/example-plugin",
                  displayName: "Example Plugin",
                  summary: "Scoped plugin",
                  stats: { downloads: 7, installs: 3, stars: 1, versions: 1 },
                  updatedAt: 5,
                },
              ]);
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    const result = await listPublishedPageHandler(ctx as never, {
      handle: "openclaw",
      paginationOpts: { cursor: null, numItems: 12 },
    });

    expect(result.page).toMatchObject([
      { displayName: "Example Plugin", href: "/plugins/@openclaw/example-plugin" },
    ]);
  });

  it("lets admins mark publishers official by handle", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:admin" as never);
    const now = vi.spyOn(Date, "now").mockReturnValue(123);
    const publishers = new Map<string, Record<string, unknown>>([
      [
        "publishers:steipete",
        {
          _id: "publishers:steipete",
          _creationTime: 1,
          kind: "user",
          handle: "steipete",
          displayName: "Peter",
          linkedUserId: "users:steipete",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    ]);
    const packages = new Map<string, Record<string, unknown>>([
      [
        "packages:plugin",
        {
          _id: "packages:plugin",
          _creationTime: 1,
          name: "demo-plugin",
          normalizedName: "demo-plugin",
          displayName: "Demo Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          ownerUserId: "users:steipete",
          ownerPublisherId: "publishers:steipete",
          tags: {},
          summary: "Demo",
          latestReleaseId: "packageReleases:plugin",
          latestVersionSummary: { version: "1.0.0" },
          stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
          createdAt: 1,
          updatedAt: 1,
          softDeletedAt: 9,
        },
      ],
      [
        "packages:legacy-plugin",
        {
          _id: "packages:legacy-plugin",
          _creationTime: 1,
          name: "legacy-plugin",
          normalizedName: "legacy-plugin",
          displayName: "Legacy Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          ownerUserId: "users:steipete",
          tags: {},
          summary: "Legacy",
          latestReleaseId: "packageReleases:legacy-plugin",
          latestVersionSummary: { version: "1.0.0" },
          stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
          createdAt: 1,
          updatedAt: 1,
          softDeletedAt: undefined,
        },
      ],
      [
        "packages:private-plugin",
        {
          _id: "packages:private-plugin",
          _creationTime: 1,
          name: "@steipete/private-plugin",
          normalizedName: "@steipete/private-plugin",
          displayName: "Private Plugin",
          family: "code-plugin",
          channel: "private",
          isOfficial: false,
          ownerUserId: "users:steipete",
          ownerPublisherId: "publishers:steipete",
          tags: {},
          summary: "Private",
          latestReleaseId: "packageReleases:private-plugin",
          latestVersionSummary: { version: "1.0.0" },
          stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
          createdAt: 1,
          updatedAt: 1,
          softDeletedAt: undefined,
        },
      ],
    ]);
    for (let index = 0; index < 100; index += 1) {
      packages.set(`packages:paged-plugin-${index}`, {
        _id: `packages:paged-plugin-${index}`,
        _creationTime: 1,
        name: `paged-plugin-${index}`,
        normalizedName: `paged-plugin-${index}`,
        displayName: `Paged Plugin ${index}`,
        family: "code-plugin",
        channel: "community",
        isOfficial: false,
        ownerUserId: "users:steipete",
        ownerPublisherId: "publishers:steipete",
        tags: {},
        summary: "Paged",
        latestReleaseId: `packageReleases:paged-plugin-${index}`,
        latestVersionSummary: { version: "1.0.0" },
        stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
        createdAt: 1,
        updatedAt: 1,
        softDeletedAt: undefined,
      });
    }
    const skills = new Map<string, Record<string, unknown>>([
      [
        "skills:helper",
        {
          _id: "skills:helper",
          _creationTime: 1,
          slug: "helper",
          displayName: "Helper",
          summary: "Helper",
          icon: undefined,
          ownerUserId: "users:steipete",
          ownerPublisherId: "publishers:steipete",
          canonicalSkillId: undefined,
          forkOf: undefined,
          latestVersionId: "skillVersions:helper",
          latestVersionSummary: { version: "1.0.0", createdAt: 1, changelog: "init" },
          tags: {},
          capabilityTags: [],
          badges: {},
          stats: { downloads: 0, installsCurrent: 0, installsAllTime: 0, stars: 0 },
          statsDownloads: 0,
          statsStars: 0,
          statsInstallsCurrent: 0,
          statsInstallsAllTime: 0,
          moderationStatus: "active",
          moderationFlags: [],
          moderationReason: undefined,
          isSuspicious: false,
          createdAt: 1,
          updatedAt: 1,
          softDeletedAt: 9,
        },
      ],
      [
        "skills:legacy-helper",
        {
          _id: "skills:legacy-helper",
          _creationTime: 1,
          slug: "legacy-helper",
          displayName: "Legacy Helper",
          summary: "Legacy Helper",
          icon: undefined,
          ownerUserId: "users:steipete",
          canonicalSkillId: undefined,
          forkOf: undefined,
          latestVersionId: "skillVersions:legacy-helper",
          latestVersionSummary: { version: "1.0.0", createdAt: 1, changelog: "init" },
          tags: {},
          capabilityTags: [],
          badges: {},
          stats: { downloads: 0, installsCurrent: 0, installsAllTime: 0, stars: 0 },
          statsDownloads: 0,
          statsStars: 0,
          statsInstallsCurrent: 0,
          statsInstallsAllTime: 0,
          moderationStatus: "active",
          moderationFlags: [],
          moderationReason: undefined,
          isSuspicious: false,
          createdAt: 1,
          updatedAt: 1,
          softDeletedAt: undefined,
        },
      ],
    ]);
    for (let index = 0; index < 100; index += 1) {
      skills.set(`skills:paged-helper-${index}`, {
        _id: `skills:paged-helper-${index}`,
        _creationTime: 1,
        slug: `paged-helper-${index}`,
        displayName: `Paged Helper ${index}`,
        summary: "Paged Helper",
        icon: undefined,
        ownerUserId: "users:steipete",
        ownerPublisherId: "publishers:steipete",
        canonicalSkillId: undefined,
        forkOf: undefined,
        latestVersionId: `skillVersions:paged-helper-${index}`,
        latestVersionSummary: { version: "1.0.0", createdAt: 1, changelog: "init" },
        tags: {},
        capabilityTags: [],
        badges: {},
        stats: { downloads: 0, installsCurrent: 0, installsAllTime: 0, stars: 0 },
        statsDownloads: 0,
        statsStars: 0,
        statsInstallsCurrent: 0,
        statsInstallsAllTime: 0,
        moderationStatus: "active",
        moderationFlags: [],
        moderationReason: undefined,
        isSuspicious: false,
        createdAt: 1,
        updatedAt: 1,
        softDeletedAt: undefined,
      });
    }
    const skillBadges = new Map<string, Record<string, unknown>>();
    const skillSearchDigests = new Map<string, Record<string, unknown>>([
      [
        "skillSearchDigest:helper",
        {
          _id: "skillSearchDigest:helper",
          skillId: "skills:helper",
          badges: {},
        },
      ],
      [
        "skillSearchDigest:legacy-helper",
        {
          _id: "skillSearchDigest:legacy-helper",
          skillId: "skills:legacy-helper",
          badges: {},
        },
      ],
    ]);
    const packageSearchDigests = new Map<string, Record<string, unknown>>([
      [
        "packageSearchDigest:plugin",
        {
          _id: "packageSearchDigest:plugin",
          packageId: "packages:plugin",
          channel: "community",
          isOfficial: false,
        },
      ],
      [
        "packageSearchDigest:legacy-plugin",
        {
          _id: "packageSearchDigest:legacy-plugin",
          packageId: "packages:legacy-plugin",
          channel: "community",
          isOfficial: false,
        },
      ],
    ]);
    const patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
      if (publishers.has(id)) publishers.set(id, { ...publishers.get(id), ...value });
      if (packages.has(id)) packages.set(id, { ...packages.get(id), ...value });
      if (skills.has(id)) skills.set(id, { ...skills.get(id), ...value });
      if (skillBadges.has(id)) skillBadges.set(id, { ...skillBadges.get(id), ...value });
      if (skillSearchDigests.has(id)) {
        skillSearchDigests.set(id, { ...skillSearchDigests.get(id), ...value });
      }
      if (packageSearchDigests.has(id)) {
        packageSearchDigests.set(id, { ...packageSearchDigests.get(id), ...value });
      }
    });
    const insert = vi.fn(async (table: string, value: Record<string, unknown>) => {
      if (table === "skillBadges") {
        const id = `skillBadges:${skillBadges.size + 1}`;
        skillBadges.set(id, { _id: id, ...value });
        return id;
      }
      return "auditLogs:1";
    });
    const deleteRow = vi.fn(async (id: string) => {
      skillBadges.delete(id);
    });
    const runAfter = vi.fn(async (_delay: number, _ref: unknown, _args: unknown) => undefined);
    const ctx = {
      scheduler: { runAfter },
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:admin") return { _id: id, role: "admin" };
          return publishers.get(id) ?? null;
        }),
        query: vi.fn((table: string) => {
          if (table === "packages") {
            return {
              withIndex: vi.fn((indexName: string, buildQuery: (query: unknown) => unknown) => {
                const fields: Record<string, unknown> = {};
                const q = {
                  eq(field: string, value: unknown) {
                    fields[field] = value;
                    return q;
                  },
                };
                buildQuery(q);
                if (indexName !== "by_owner_publisher" && indexName !== "by_owner") {
                  throw new Error(`unexpected index ${indexName}`);
                }
                return indexedRows(
                  [...packages.values()].filter((pkg) => {
                    if (indexName === "by_owner_publisher") {
                      return pkg.ownerPublisherId === fields.ownerPublisherId;
                    }
                    return pkg.ownerUserId === fields.ownerUserId;
                  }),
                );
              }),
            };
          }
          if (table === "skills") {
            return {
              withIndex: vi.fn((indexName: string, buildQuery: (query: unknown) => unknown) => {
                const fields: Record<string, unknown> = {};
                const q = {
                  eq(field: string, value: unknown) {
                    fields[field] = value;
                    return q;
                  },
                };
                buildQuery(q);
                if (indexName !== "by_owner_publisher" && indexName !== "by_owner") {
                  throw new Error(`unexpected index ${indexName}`);
                }
                return indexedRows(
                  [...skills.values()].filter((skill) => {
                    if (indexName === "by_owner_publisher") {
                      return skill.ownerPublisherId === fields.ownerPublisherId;
                    }
                    return skill.ownerUserId === fields.ownerUserId;
                  }),
                );
              }),
            };
          }
          if (table === "skillBadges") {
            return {
              withIndex: vi.fn((indexName: string, buildQuery: (query: unknown) => unknown) => {
                const fields: Record<string, unknown> = {};
                const q = {
                  eq(field: string, value: unknown) {
                    fields[field] = value;
                    return q;
                  },
                };
                buildQuery(q);
                if (indexName !== "by_skill_kind") {
                  throw new Error(`unexpected index ${indexName}`);
                }
                return {
                  unique: vi.fn(
                    async () =>
                      [...skillBadges.values()].find(
                        (badge) => badge.skillId === fields.skillId && badge.kind === fields.kind,
                      ) ?? null,
                  ),
                };
              }),
            };
          }
          if (table === "skillSearchDigest") {
            return {
              withIndex: vi.fn((indexName: string, buildQuery: (query: unknown) => unknown) => {
                const fields: Record<string, unknown> = {};
                const q = {
                  eq(field: string, value: unknown) {
                    fields[field] = value;
                    return q;
                  },
                };
                buildQuery(q);
                if (indexName !== "by_skill") throw new Error(`unexpected index ${indexName}`);
                return {
                  unique: vi.fn(
                    async () =>
                      [...skillSearchDigests.values()].find(
                        (digest) => digest.skillId === fields.skillId,
                      ) ?? null,
                  ),
                };
              }),
            };
          }
          if (table === "packageSearchDigest") {
            return {
              withIndex: vi.fn((indexName: string, buildQuery: (query: unknown) => unknown) => {
                const fields: Record<string, unknown> = {};
                const q = {
                  eq(field: string, value: unknown) {
                    fields[field] = value;
                    return q;
                  },
                };
                buildQuery(q);
                if (indexName !== "by_package") throw new Error(`unexpected index ${indexName}`);
                return {
                  unique: vi.fn(
                    async () =>
                      [...packageSearchDigests.values()].find(
                        (digest) => digest.packageId === fields.packageId,
                      ) ?? null,
                  ),
                };
              }),
            };
          }
          if (table === "packageCapabilitySearchDigest") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName !== "by_package") throw new Error(`unexpected index ${indexName}`);
                return indexedRows([]);
              }),
            };
          }
          if (table === "packagePluginCategorySearchDigest") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName !== "by_package") throw new Error(`unexpected index ${indexName}`);
                return indexedRows([]);
              }),
            };
          }
          if (table !== "publishers") throw new Error(`unexpected table ${table}`);
          return {
            withIndex: vi.fn((indexName: string, buildQuery: (query: unknown) => unknown) => {
              const fields: Record<string, unknown> = {};
              const q = {
                eq(field: string, value: unknown) {
                  fields[field] = value;
                  return q;
                },
              };
              buildQuery(q);
              if (indexName !== "by_handle") throw new Error(`unexpected index ${indexName}`);
              return {
                unique: vi.fn(
                  async () =>
                    [...publishers.values()].find(
                      (publisher) => publisher.handle === fields.handle,
                    ) ?? null,
                ),
              };
            }),
          };
        }),
        patch,
        insert,
        delete: deleteRow,
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    const result = await setOfficialPublisherHandler(ctx as never, {
      handle: "steipete",
      official: true,
    });

    expect(result.publisher?.official).toBe(true);
    expect(result.skillSync).toEqual({ updatedSkills: 101, skillSyncTruncated: true });
    expect(result.packageSync).toEqual({ updatedPackages: 100, packageSyncTruncated: true });
    expect(runAfter.mock.calls.map((call) => call[2])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: "scoped", cursor: "100", officialAt: 123 }),
        expect.objectContaining({
          phase: "scoped",
          cursor: "100",
          officialBadge: expect.objectContaining({ byUserId: "users:admin" }),
        }),
      ]),
    );
    expect(patch).toHaveBeenCalledWith("publishers:steipete", {
      official: { byUserId: "users:admin", at: 123 },
      updatedAt: 123,
    });
    expect(patch).toHaveBeenCalledWith(
      "packages:plugin",
      expect.objectContaining({
        channel: "official",
        isOfficial: true,
        updatedAt: 123,
      }),
    );
    expect(insert).toHaveBeenCalledWith("skillBadges", {
      skillId: "skills:helper",
      kind: "official",
      byUserId: "users:admin",
      at: 123,
      sourcePublisherId: "publishers:steipete",
    });
    expect(patch).toHaveBeenCalledWith("skills:helper", {
      badges: {
        official: {
          byUserId: "users:admin",
          at: 123,
          sourcePublisherId: "publishers:steipete",
        },
      },
    });
    expect(patch).toHaveBeenCalledWith("skills:legacy-helper", {
      badges: {
        official: {
          byUserId: "users:admin",
          at: 123,
          sourcePublisherId: "publishers:steipete",
        },
      },
    });
    expect(patch).toHaveBeenCalledWith("skills:paged-helper-98", {
      badges: {
        official: {
          byUserId: "users:admin",
          at: 123,
          sourcePublisherId: "publishers:steipete",
        },
      },
    });
    expect(patch).not.toHaveBeenCalledWith("skills:paged-helper-99", expect.anything());
    expect(patch).toHaveBeenCalledWith("skillSearchDigest:helper", {
      badges: {
        official: {
          byUserId: "users:admin",
          at: 123,
          sourcePublisherId: "publishers:steipete",
        },
      },
      isOfficial: true,
    });
    expect(patch).toHaveBeenCalledWith("skillSearchDigest:legacy-helper", {
      badges: {
        official: {
          byUserId: "users:admin",
          at: 123,
          sourcePublisherId: "publishers:steipete",
        },
      },
      isOfficial: true,
    });
    expect(patch).toHaveBeenCalledWith(
      "packageSearchDigest:plugin",
      expect.objectContaining({
        channel: "official",
        isOfficial: true,
        ownerHandle: "steipete",
        ownerKind: "user",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "packages:legacy-plugin",
      expect.objectContaining({
        channel: "official",
        isOfficial: true,
        updatedAt: 123,
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "packages:paged-plugin-97",
      expect.objectContaining({
        channel: "official",
        isOfficial: true,
        updatedAt: 123,
      }),
    );
    expect(patch).not.toHaveBeenCalledWith("packages:paged-plugin-99", expect.anything());
    expect(patch).toHaveBeenCalledWith(
      "packageSearchDigest:legacy-plugin",
      expect.objectContaining({
        channel: "official",
        isOfficial: true,
        ownerHandle: "steipete",
        ownerKind: "user",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "publisher.official.set",
        targetId: "publishers:steipete",
      }),
    );

    patch.mockClear();
    insert.mockClear();
    deleteRow.mockClear();
    now.mockReturnValue(456);

    const setAgainResult = await setOfficialPublisherHandler(ctx as never, {
      handle: "steipete",
      official: true,
    });

    expect(setAgainResult.publisher?.official).toBe(true);
    expect(setAgainResult.skillSync).toEqual({ updatedSkills: 0, skillSyncTruncated: true });
    expect(setAgainResult.packageSync).toEqual({ updatedPackages: 0, packageSyncTruncated: true });
    expect(patch).toHaveBeenCalledWith("publishers:steipete", {
      official: { byUserId: "users:admin", at: 123 },
      updatedAt: 456,
    });
    expect(deleteRow).not.toHaveBeenCalled();

    patch.mockClear();
    insert.mockClear();
    deleteRow.mockClear();

    const unsetResult = await setOfficialPublisherHandler(ctx as never, {
      handle: "steipete",
      official: false,
    });

    expect(unsetResult.publisher?.official).toBe(false);
    expect(unsetResult.skillSync).toEqual({ updatedSkills: 101, skillSyncTruncated: true });
    expect(unsetResult.packageSync).toEqual({ updatedPackages: 100, packageSyncTruncated: true });
    expect(patch).toHaveBeenCalledWith("publishers:steipete", {
      official: undefined,
      updatedAt: 456,
    });
    expect(deleteRow).toHaveBeenCalledWith("skillBadges:1");
    expect(patch).toHaveBeenCalledWith("skills:helper", { badges: {} });
    expect(patch).toHaveBeenCalledWith("skills:legacy-helper", { badges: {} });
    expect(patch).toHaveBeenCalledWith("skills:paged-helper-98", { badges: {} });
    expect(patch).toHaveBeenCalledWith("skillSearchDigest:helper", {
      badges: {},
      isOfficial: false,
    });
    expect(patch).toHaveBeenCalledWith("skillSearchDigest:legacy-helper", {
      badges: {},
      isOfficial: false,
    });
    expect(patch).toHaveBeenCalledWith(
      "packages:plugin",
      expect.objectContaining({
        channel: "community",
        isOfficial: false,
        updatedAt: 456,
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "packages:legacy-plugin",
      expect.objectContaining({
        channel: "community",
        isOfficial: false,
        updatedAt: 456,
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "packages:paged-plugin-97",
      expect.objectContaining({
        channel: "community",
        isOfficial: false,
        updatedAt: 456,
      }),
    );
    expect(patch).not.toHaveBeenCalledWith(
      "packages:private-plugin",
      expect.objectContaining({ channel: "community" }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "publisher.official.unset",
        targetId: "publishers:steipete",
      }),
    );
    now.mockRestore();
  });

  it("repairs missing official skill badge rows when the skill badge is already denormalized", async () => {
    const officialBadge = {
      byUserId: "users:admin",
      at: 123,
      sourcePublisherId: "publishers:steipete",
    };
    const insert = vi.fn(async () => "skillBadges:official");
    const patch = vi.fn();
    const ctx = {
      scheduler: { runAfter: vi.fn() },
      db: {
        get: vi.fn(async (id: string) =>
          id === "publishers:steipete"
            ? {
                _id: "publishers:steipete",
                kind: "user",
                handle: "steipete",
                linkedUserId: "users:steipete",
                official: { byUserId: "users:admin", at: 123 },
              }
            : null,
        ),
        query: vi.fn((table: string) => {
          if (table === "skills") {
            return {
              withIndex: vi.fn(() =>
                indexedRows([
                  {
                    _id: "skills:helper",
                    ownerUserId: "users:steipete",
                    ownerPublisherId: "publishers:steipete",
                    badges: { official: officialBadge },
                  },
                ]),
              ),
            };
          }
          if (table === "skillBadges") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn(async () => null),
              })),
            };
          }
          if (table === "skillSearchDigest") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn(async () => null),
              })),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
        patch,
        insert,
        delete: vi.fn(),
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    await expect(
      syncPublisherSkillOfficialStateBatchInternalHandler(ctx as never, {
        publisherId: "publishers:steipete",
        official: true,
        officialBadge,
        now: 456,
        phase: "scoped",
        cursor: null,
      }),
    ).resolves.toEqual({ updatedSkills: 1, skillSyncTruncated: false });

    expect(insert).toHaveBeenCalledWith("skillBadges", {
      skillId: "skills:helper",
      kind: "official",
      byUserId: "users:admin",
      at: 123,
      sourcePublisherId: "publishers:steipete",
    });
    expect(patch).not.toHaveBeenCalledWith("skills:helper", expect.anything());
  });

  it("repairs stale official skill search digest badges when the skill badge is already denormalized", async () => {
    const officialBadge = {
      byUserId: "users:admin",
      at: 123,
      sourcePublisherId: "publishers:steipete",
    };
    const patch = vi.fn();
    const ctx = {
      scheduler: { runAfter: vi.fn() },
      db: {
        get: vi.fn(async (id: string) =>
          id === "publishers:steipete"
            ? {
                _id: "publishers:steipete",
                kind: "user",
                handle: "steipete",
                linkedUserId: "users:steipete",
                official: { byUserId: "users:admin", at: 123 },
              }
            : null,
        ),
        query: vi.fn((table: string) => {
          if (table === "skills") {
            return {
              withIndex: vi.fn(() =>
                indexedRows([
                  {
                    _id: "skills:helper",
                    ownerUserId: "users:steipete",
                    ownerPublisherId: "publishers:steipete",
                    badges: { official: officialBadge },
                  },
                ]),
              ),
            };
          }
          if (table === "skillBadges") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn(async () => ({
                  _id: "skillBadges:official",
                  skillId: "skills:helper",
                  kind: "official",
                  ...officialBadge,
                })),
              })),
            };
          }
          if (table === "skillSearchDigest") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn(async () => ({
                  _id: "skillSearchDigest:helper",
                  skillId: "skills:helper",
                  badges: {},
                  isOfficial: true,
                })),
              })),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
        patch,
        insert: vi.fn(),
        delete: vi.fn(),
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    await expect(
      syncPublisherSkillOfficialStateBatchInternalHandler(ctx as never, {
        publisherId: "publishers:steipete",
        official: true,
        officialBadge,
        now: 456,
        phase: "scoped",
        cursor: null,
      }),
    ).resolves.toEqual({ updatedSkills: 1, skillSyncTruncated: false });

    expect(patch).toHaveBeenCalledWith("skillSearchDigest:helper", {
      badges: { official: officialBadge },
      isOfficial: true,
    });
    expect(patch).not.toHaveBeenCalledWith("skills:helper", expect.anything());
  });

  it("does not remove manual skill official badges when publisher official is unset", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:admin" as never);
    const now = vi.spyOn(Date, "now").mockReturnValue(456);
    const publishers = new Map<string, Record<string, unknown>>([
      [
        "publishers:steipete",
        {
          _id: "publishers:steipete",
          _creationTime: 1,
          kind: "user",
          handle: "steipete",
          displayName: "Peter",
          linkedUserId: "users:steipete",
          official: { byUserId: "users:admin", at: 123 },
          createdAt: 1,
          updatedAt: 123,
        },
      ],
    ]);
    const manualBadge = { byUserId: "users:reviewer", at: 222 };
    const skills = new Map<string, Record<string, unknown>>([
      [
        "skills:manual",
        {
          _id: "skills:manual",
          _creationTime: 1,
          slug: "manual",
          displayName: "Manual",
          ownerUserId: "users:steipete",
          ownerPublisherId: "publishers:steipete",
          badges: { official: manualBadge },
          tags: {},
          stats: { downloads: 0, installsCurrent: 0, installsAllTime: 0, stars: 0 },
          statsDownloads: 0,
          statsStars: 0,
          statsInstallsCurrent: 0,
          statsInstallsAllTime: 0,
          createdAt: 1,
          updatedAt: 222,
        },
      ],
    ]);
    const skillBadges = new Map<string, Record<string, unknown>>([
      [
        "skillBadges:manual",
        {
          _id: "skillBadges:manual",
          skillId: "skills:manual",
          kind: "official",
          ...manualBadge,
        },
      ],
    ]);
    const patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
      if (publishers.has(id)) publishers.set(id, { ...publishers.get(id), ...value });
      if (skills.has(id)) skills.set(id, { ...skills.get(id), ...value });
    });
    const deleteRow = vi.fn();
    const ctx = {
      scheduler: { runAfter: vi.fn() },
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:admin") return { _id: id, role: "admin" };
          return publishers.get(id) ?? null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publishers") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn(async () => publishers.get("publishers:steipete") ?? null),
              })),
            };
          }
          if (table === "skills") {
            return { withIndex: vi.fn(() => indexedRows([...skills.values()])) };
          }
          if (table === "packages") {
            return { withIndex: vi.fn(() => indexedRows([])) };
          }
          if (table === "skillBadges") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn(async () => skillBadges.get("skillBadges:manual") ?? null),
              })),
            };
          }
          if (table === "skillSearchDigest") {
            return { withIndex: vi.fn(() => ({ unique: vi.fn(async () => null) })) };
          }
          throw new Error(`unexpected table ${table}`);
        }),
        patch,
        insert: vi.fn(async () => "auditLogs:1"),
        delete: deleteRow,
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    await setOfficialPublisherHandler(ctx as never, {
      handle: "steipete",
      official: false,
    });

    expect(deleteRow).not.toHaveBeenCalledWith("skillBadges:manual");
    expect(patch).not.toHaveBeenCalledWith(
      "skills:manual",
      expect.objectContaining({ badges: {} }),
    );
    expect(skills.get("skills:manual")?.badges).toEqual({ official: manualBadge });
    now.mockRestore();
  });

  it("removes publisher-derived skill badges when an official unset is retried", async () => {
    const publisherBadge = {
      byUserId: "users:admin",
      at: 123,
      sourcePublisherId: "publishers:steipete",
    };
    const manualBadge = { byUserId: "users:reviewer", at: 222 };
    const skills = new Map<string, Record<string, unknown>>([
      [
        "skills:helper",
        {
          _id: "skills:helper",
          ownerUserId: "users:steipete",
          ownerPublisherId: "publishers:steipete",
          badges: { official: publisherBadge },
        },
      ],
      [
        "skills:manual",
        {
          _id: "skills:manual",
          ownerUserId: "users:steipete",
          ownerPublisherId: "publishers:steipete",
          badges: { official: manualBadge },
        },
      ],
    ]);
    const skillBadges = new Map<string, Record<string, unknown>>([
      [
        "skillBadges:helper",
        {
          _id: "skillBadges:helper",
          skillId: "skills:helper",
          kind: "official",
          ...publisherBadge,
        },
      ],
      [
        "skillBadges:manual",
        {
          _id: "skillBadges:manual",
          skillId: "skills:manual",
          kind: "official",
          ...manualBadge,
        },
      ],
    ]);
    const skillSearchDigests = new Map<string, Record<string, unknown>>([
      [
        "skillSearchDigest:helper",
        {
          _id: "skillSearchDigest:helper",
          skillId: "skills:helper",
          badges: { official: publisherBadge },
        },
      ],
      [
        "skillSearchDigest:manual",
        {
          _id: "skillSearchDigest:manual",
          skillId: "skills:manual",
          badges: { official: manualBadge },
        },
      ],
    ]);
    const patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
      if (skills.has(id)) skills.set(id, { ...skills.get(id), ...value });
      if (skillSearchDigests.has(id)) {
        skillSearchDigests.set(id, { ...skillSearchDigests.get(id), ...value });
      }
    });
    const deleteRow = vi.fn(async (id: string) => {
      skillBadges.delete(id);
    });
    const ctx = {
      scheduler: { runAfter: vi.fn() },
      db: {
        get: vi.fn(async (id: string) =>
          id === "publishers:steipete"
            ? {
                _id: "publishers:steipete",
                kind: "user",
                handle: "steipete",
                linkedUserId: "users:steipete",
                official: undefined,
              }
            : null,
        ),
        query: vi.fn((table: string) => {
          if (table === "skills") {
            return { withIndex: vi.fn(() => indexedRows([...skills.values()])) };
          }
          if (table === "skillBadges") {
            return {
              withIndex: vi.fn((indexName: string, buildQuery: (query: unknown) => unknown) => {
                const fields: Record<string, unknown> = {};
                const q = {
                  eq(field: string, value: unknown) {
                    fields[field] = value;
                    return q;
                  },
                };
                buildQuery(q);
                if (indexName !== "by_skill_kind") {
                  throw new Error(`unexpected index ${indexName}`);
                }
                return {
                  unique: vi.fn(
                    async () =>
                      [...skillBadges.values()].find(
                        (badge) => badge.skillId === fields.skillId && badge.kind === fields.kind,
                      ) ?? null,
                  ),
                };
              }),
            };
          }
          if (table === "skillSearchDigest") {
            return {
              withIndex: vi.fn((indexName: string, buildQuery: (query: unknown) => unknown) => {
                const fields: Record<string, unknown> = {};
                const q = {
                  eq(field: string, value: unknown) {
                    fields[field] = value;
                    return q;
                  },
                };
                buildQuery(q);
                if (indexName !== "by_skill") throw new Error(`unexpected index ${indexName}`);
                return {
                  unique: vi.fn(
                    async () =>
                      [...skillSearchDigests.values()].find(
                        (digest) => digest.skillId === fields.skillId,
                      ) ?? null,
                  ),
                };
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
        patch,
        insert: vi.fn(),
        delete: deleteRow,
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    await expect(
      syncPublisherSkillOfficialStateBatchInternalHandler(ctx as never, {
        publisherId: "publishers:steipete",
        official: false,
        now: 456,
        phase: "scoped",
        cursor: null,
      }),
    ).resolves.toEqual({ updatedSkills: 1, skillSyncTruncated: false });

    expect(deleteRow).toHaveBeenCalledWith("skillBadges:helper");
    expect(deleteRow).not.toHaveBeenCalledWith("skillBadges:manual");
    expect(patch).toHaveBeenCalledWith("skills:helper", { badges: {} });
    expect(patch).toHaveBeenCalledWith("skillSearchDigest:helper", {
      badges: {},
      isOfficial: false,
    });
    expect(skills.get("skills:manual")?.badges).toEqual({ official: manualBadge });
    expect(skillSearchDigests.get("skillSearchDigest:manual")?.badges).toEqual({
      official: manualBadge,
    });
  });

  it("removes stale publisher-derived skill badges when official unset uses the old marker", async () => {
    const oldPublisherBadge = {
      byUserId: "users:admin",
      at: 123,
      sourcePublisherId: "publishers:steipete",
    };
    const stalePublisherBadge = {
      byUserId: "users:admin",
      at: 111,
      sourcePublisherId: "publishers:steipete",
    };
    const skills = new Map<string, Record<string, unknown>>([
      [
        "skills:helper",
        {
          _id: "skills:helper",
          ownerUserId: "users:steipete",
          ownerPublisherId: "publishers:steipete",
          badges: { official: stalePublisherBadge },
        },
      ],
    ]);
    const skillBadges = new Map<string, Record<string, unknown>>([
      [
        "skillBadges:helper",
        {
          _id: "skillBadges:helper",
          skillId: "skills:helper",
          kind: "official",
          ...stalePublisherBadge,
        },
      ],
    ]);
    const skillSearchDigests = new Map<string, Record<string, unknown>>([
      [
        "skillSearchDigest:helper",
        {
          _id: "skillSearchDigest:helper",
          skillId: "skills:helper",
          badges: { official: stalePublisherBadge },
        },
      ],
    ]);
    const patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
      if (skills.has(id)) skills.set(id, { ...skills.get(id), ...value });
      if (skillSearchDigests.has(id)) {
        skillSearchDigests.set(id, { ...skillSearchDigests.get(id), ...value });
      }
    });
    const deleteRow = vi.fn(async (id: string) => {
      skillBadges.delete(id);
    });
    const ctx = {
      scheduler: { runAfter: vi.fn() },
      db: {
        get: vi.fn(async (id: string) =>
          id === "publishers:steipete"
            ? {
                _id: "publishers:steipete",
                kind: "user",
                handle: "steipete",
                linkedUserId: "users:steipete",
                official: undefined,
              }
            : null,
        ),
        query: vi.fn((table: string) => {
          if (table === "skills") {
            return { withIndex: vi.fn(() => indexedRows([...skills.values()])) };
          }
          if (table === "skillBadges") {
            return {
              withIndex: vi.fn((indexName: string, buildQuery: (query: unknown) => unknown) => {
                const fields: Record<string, unknown> = {};
                const q = {
                  eq(field: string, value: unknown) {
                    fields[field] = value;
                    return q;
                  },
                };
                buildQuery(q);
                if (indexName !== "by_skill_kind") {
                  throw new Error(`unexpected index ${indexName}`);
                }
                return {
                  unique: vi.fn(
                    async () =>
                      [...skillBadges.values()].find(
                        (badge) => badge.skillId === fields.skillId && badge.kind === fields.kind,
                      ) ?? null,
                  ),
                };
              }),
            };
          }
          if (table === "skillSearchDigest") {
            return {
              withIndex: vi.fn((indexName: string, buildQuery: (query: unknown) => unknown) => {
                const fields: Record<string, unknown> = {};
                const q = {
                  eq(field: string, value: unknown) {
                    fields[field] = value;
                    return q;
                  },
                };
                buildQuery(q);
                if (indexName !== "by_skill") throw new Error(`unexpected index ${indexName}`);
                return {
                  unique: vi.fn(
                    async () =>
                      [...skillSearchDigests.values()].find(
                        (digest) => digest.skillId === fields.skillId,
                      ) ?? null,
                  ),
                };
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
        patch,
        insert: vi.fn(),
        delete: deleteRow,
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    await expect(
      syncPublisherSkillOfficialStateBatchInternalHandler(ctx as never, {
        publisherId: "publishers:steipete",
        official: false,
        officialBadge: oldPublisherBadge,
        now: 456,
        phase: "scoped",
        cursor: null,
      }),
    ).resolves.toEqual({ updatedSkills: 1, skillSyncTruncated: false });

    expect(deleteRow).toHaveBeenCalledWith("skillBadges:helper");
    expect(patch).toHaveBeenCalledWith("skills:helper", { badges: {} });
    expect(patch).toHaveBeenCalledWith("skillSearchDigest:helper", {
      badges: {},
      isOfficial: false,
    });
  });

  it("updates stale publisher-derived skill badges when official is re-enabled", async () => {
    const oldBadge = {
      byUserId: "users:admin",
      at: 123,
      sourcePublisherId: "publishers:steipete",
    };
    const nextBadge = {
      byUserId: "users:admin",
      at: 456,
      sourcePublisherId: "publishers:steipete",
    };
    const skill = {
      _id: "skills:helper",
      ownerUserId: "users:steipete",
      ownerPublisherId: "publishers:steipete",
      badges: { official: oldBadge },
    };
    const skillBadge = {
      _id: "skillBadges:official",
      skillId: "skills:helper",
      kind: "official",
      ...oldBadge,
    };
    const digest = {
      _id: "skillSearchDigest:helper",
      skillId: "skills:helper",
      badges: { official: oldBadge },
    };
    const patch = vi.fn();

    const ctx = {
      scheduler: { runAfter: vi.fn() },
      db: {
        get: vi.fn(async (id: string) =>
          id === "publishers:steipete"
            ? {
                _id: "publishers:steipete",
                kind: "user",
                handle: "steipete",
                linkedUserId: "users:steipete",
                official: { byUserId: "users:admin", at: 456 },
              }
            : null,
        ),
        query: vi.fn((table: string) => {
          if (table === "skills") {
            return { withIndex: vi.fn(() => indexedRows([skill])) };
          }
          if (table === "skillBadges") {
            return {
              withIndex: vi.fn(() => ({ unique: vi.fn(async () => skillBadge) })),
            };
          }
          if (table === "skillSearchDigest") {
            return {
              withIndex: vi.fn(() => ({ unique: vi.fn(async () => digest) })),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
        patch,
        insert: vi.fn(),
        delete: vi.fn(),
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    await expect(
      syncPublisherSkillOfficialStateBatchInternalHandler(ctx as never, {
        publisherId: "publishers:steipete",
        official: true,
        officialBadge: nextBadge,
        now: 456,
        phase: "scoped",
        cursor: null,
      }),
    ).resolves.toEqual({ updatedSkills: 1, skillSyncTruncated: false });

    expect(patch).toHaveBeenCalledWith("skillBadges:official", nextBadge);
    expect(patch).toHaveBeenCalledWith("skills:helper", { badges: { official: nextBadge } });
    expect(patch).toHaveBeenCalledWith("skillSearchDigest:helper", {
      badges: { official: nextBadge },
      isOfficial: true,
    });
  });

  it("ignores stale scheduled official sync batches", async () => {
    const patch = vi.fn();
    const ctx = {
      scheduler: { runAfter: vi.fn() },
      db: {
        get: vi.fn(async () => ({
          _id: "publishers:steipete",
          kind: "user",
          handle: "steipete",
          linkedUserId: "users:steipete",
          official: { byUserId: "users:admin", at: 456 },
        })),
        query: vi.fn(() => {
          throw new Error("stale batches should not query owned content");
        }),
        patch,
        insert: vi.fn(),
        delete: vi.fn(),
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    await expect(
      syncPublisherPackageOfficialStateBatchInternalHandler(ctx as never, {
        publisherId: "publishers:steipete",
        official: true,
        now: 123,
        phase: "scoped",
        cursor: "100",
      }),
    ).resolves.toEqual({ updatedPackages: 0, packageSyncTruncated: false });
    await expect(
      syncPublisherSkillOfficialStateBatchInternalHandler(ctx as never, {
        publisherId: "publishers:steipete",
        official: true,
        officialBadge: { byUserId: "users:admin", at: 123 },
        now: 123,
        phase: "scoped",
        cursor: "100",
      }),
    ).resolves.toEqual({ updatedSkills: 0, skillSyncTruncated: false });
    expect(patch).not.toHaveBeenCalled();
  });

  it("continues package official sync reruns using the stable official marker time", async () => {
    const ctx = {
      scheduler: { runAfter: vi.fn() },
      db: {
        get: vi.fn(async () => ({
          _id: "publishers:steipete",
          kind: "user",
          handle: "steipete",
          linkedUserId: "users:steipete",
          official: { byUserId: "users:admin", at: 123 },
        })),
        query: vi.fn((table: string) => {
          if (table !== "packages") throw new Error(`unexpected table ${table}`);
          return {
            withIndex: vi.fn((indexName: string) => {
              if (indexName !== "by_owner_publisher") {
                throw new Error(`unexpected index ${indexName}`);
              }
              return indexedRows([]);
            }),
          };
        }),
        patch: vi.fn(),
        insert: vi.fn(),
        delete: vi.fn(),
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    await expect(
      syncPublisherPackageOfficialStateBatchInternalHandler(ctx as never, {
        publisherId: "publishers:steipete",
        official: true,
        officialAt: 123,
        now: 456,
        phase: "scoped",
        cursor: "100",
      }),
    ).resolves.toEqual({ updatedPackages: 0, packageSyncTruncated: false });
    expect(ctx.db.query).toHaveBeenCalledWith("packages");
  });

  it("includes skill.icon on catalog items and surfaces null for plugins (F7)", async () => {
    // Regression guard for F2: listPublishedPage must mirror `skills.icon`
    // onto the catalog DTO so the publisher profile page (/p/<handle>) can
    // render the same custom glyph that SkillCard / SkillListItem show on
    // /skills and /search. Plugins always carry `icon: null` in Phase 1.
    const publisher = {
      _id: "publishers:openclaw",
      _creationTime: 1,
      kind: "org",
      handle: "openclaw",
      displayName: "OpenClaw",
      createdAt: 1,
      updatedAt: 1,
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => (id === "publishers:openclaw" ? publisher : null)),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string, buildQuery: (q: unknown) => unknown) => {
            const fields: Record<string, unknown> = {};
            const q = {
              eq: (field: string, value: unknown) => {
                fields[field] = value;
                return q;
              },
            };
            buildQuery(q);
            if (table === "publishers" && indexName === "by_handle") {
              return {
                unique: vi.fn(async () => (fields.handle === "openclaw" ? publisher : null)),
              };
            }
            if (table === "skills" && indexName === "by_owner_publisher_active_updated") {
              return indexedRows([
                {
                  _id: "skills:icon-skill",
                  ownerPublisherId: "publishers:openclaw",
                  softDeletedAt: undefined,
                  slug: "icon-skill",
                  displayName: "Icon Skill",
                  summary: "Has a custom icon",
                  icon: "lucide:Plug",
                  badges: { official: { byUserId: "users:admin", at: 1 } },
                  stats: {
                    downloads: 10,
                    downloadsAllTime: 10,
                    installs: 5,
                    installsAllTime: 5,
                    stars: 2,
                  },
                  updatedAt: 8,
                },
                {
                  _id: "skills:plain-skill",
                  ownerPublisherId: "publishers:openclaw",
                  softDeletedAt: undefined,
                  slug: "plain-skill",
                  displayName: "Plain Skill",
                  summary: "No icon set",
                  // icon intentionally absent — must surface as null on the DTO
                  stats: {
                    downloads: 7,
                    downloadsAllTime: 7,
                    installs: 3,
                    installsAllTime: 3,
                    stars: 1,
                  },
                  updatedAt: 6,
                },
              ]);
            }
            if (table === "packages" && indexName === "by_owner_publisher_active_updated") {
              return indexedRows([
                {
                  _id: "packages:plugin",
                  ownerPublisherId: "publishers:openclaw",
                  softDeletedAt: undefined,
                  family: "code-plugin",
                  name: "@openclaw/example-plugin",
                  displayName: "Example Plugin",
                  summary: "A plugin",
                  isOfficial: true,
                  stats: { downloads: 5, installs: 2, stars: 0, versions: 1 },
                  updatedAt: 4,
                },
              ]);
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    const result = (await listPublishedPageHandler(ctx as never, {
      handle: "openclaw",
      paginationOpts: { cursor: null, numItems: 12 },
    })) as unknown as {
      page: Array<{
        displayName: string;
        kind: "skill" | "plugin";
        icon: string | null;
        isOfficial: boolean;
      }>;
    };

    const byName = Object.fromEntries(result.page.map((item) => [item.displayName, item]));
    // Skill with a stored icon must surface it on the DTO.
    expect(byName["Icon Skill"]).toMatchObject({
      kind: "skill",
      icon: "lucide:Plug",
      isOfficial: true,
    });
    // Skill without an icon must surface null (not undefined) so the client
    // type is uniform and MarketplaceIcon can safely pass it to parseSkillIcon.
    expect(byName["Plain Skill"]).toMatchObject({ kind: "skill", icon: null });
    // Plugins always carry null in Phase 1.
    expect(byName["Example Plugin"]).toMatchObject({
      kind: "plugin",
      icon: null,
      isOfficial: true,
    });
  });

  it("prevents admins from promoting members to owner", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:admin" as never);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:admin") return { _id: id };
          if (id === "publishers:org") {
            return {
              _id: id,
              kind: "org",
              handle: "acme",
              displayName: "Acme",
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue({
                  _id: "publisherMembers:admin",
                  publisherId: "publishers:org",
                  userId: "users:admin",
                  role: "admin",
                }),
              })),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
        insert: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    await expect(
      addMemberHandler(
        ctx as never,
        { publisherId: "publishers:org", userHandle: "peter", role: "owner" } as never,
      ),
    ).rejects.toThrow("Only org owners can promote members to owner");
  });

  it("prevents removing the last remaining owner", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:owner") return { _id: id };
          if (id === "publishers:org") {
            return {
              _id: id,
              kind: "org",
              handle: "acme",
              displayName: "Acme",
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName === "by_publisher_user") {
                  return {
                    unique: vi
                      .fn()
                      .mockResolvedValueOnce({
                        _id: "publisherMembers:owner-actor",
                        publisherId: "publishers:org",
                        userId: "users:owner",
                        role: "owner",
                      })
                      .mockResolvedValueOnce({
                        _id: "publisherMembers:owner-target",
                        publisherId: "publishers:org",
                        userId: "users:owner",
                        role: "owner",
                      }),
                  };
                }
                if (indexName === "by_publisher") {
                  return {
                    collect: vi.fn().mockResolvedValue([
                      {
                        _id: "publisherMembers:owner-target",
                        publisherId: "publishers:org",
                        userId: "users:owner",
                        role: "owner",
                      },
                    ]),
                  };
                }
                throw new Error(`unexpected index ${indexName}`);
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
        delete: vi.fn(),
        insert: vi.fn(),
        patch: vi.fn(),
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    await expect(
      removeMemberHandler(
        ctx as never,
        { publisherId: "publishers:org", userId: "users:owner" } as never,
      ),
    ).rejects.toThrow("Publisher must have at least one owner");
  });

  it("adds a member when the requested handle resolves via a personal publisher", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const publisherMembers: Array<Record<string, unknown>> = [
      {
        _id: "publisherMembers:owner",
        publisherId: "publishers:org",
        userId: "users:owner",
        role: "owner",
      },
    ];
    const insert = vi.fn(async (table: string, value: Record<string, unknown>) => {
      if (table === "publisherMembers") {
        const row = { _id: "publisherMembers:new", ...value };
        publisherMembers.push(row);
        return row._id;
      }
      if (table === "auditLogs") return "auditLogs:1";
      if (table === "publishers") return "publishers:jaredforreal";
      throw new Error(`unexpected insert ${table}`);
    });
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:owner") return { _id: id };
          if (id === "users:jared") {
            return {
              _id: id,
              _creationTime: 1,
              handle: undefined,
              name: "JaredForReal",
              displayName: "Jared",
              trustedPublisher: false,
              createdAt: 1,
              updatedAt: 1,
            };
          }
          if (id === "publishers:org") {
            return {
              _id: id,
              kind: "org",
              handle: "zai-org",
              displayName: "ZAI Org",
            };
          }
          if (id === "publishers:jaredforreal") {
            return {
              _id: id,
              _creationTime: 1,
              kind: "user",
              handle: "jaredforreal",
              displayName: "Jared",
              linkedUserId: "users:jared",
              trustedPublisher: false,
              createdAt: 1,
              updatedAt: 1,
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(
                (
                  indexName: string,
                  builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
                ) => {
                  if (indexName !== "by_publisher_user") {
                    throw new Error(`unexpected index ${indexName}`);
                  }
                  let publisherId = "";
                  let userId = "";
                  const q = {
                    eq: (field: string, value: string) => {
                      if (field === "publisherId") publisherId = value;
                      if (field === "userId") userId = value;
                      return q;
                    },
                  };
                  builder?.(q);
                  return {
                    unique: vi.fn(
                      async () =>
                        publisherMembers.find(
                          (member) =>
                            member.publisherId === publisherId && member.userId === userId,
                        ) ?? null,
                    ),
                  };
                },
              ),
            };
          }
          if (table === "users") {
            return {
              withIndex: vi.fn(
                (
                  indexName: string,
                  builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
                ) => {
                  if (indexName !== "handle") {
                    throw new Error(`unexpected index ${indexName}`);
                  }
                  let handle = "";
                  const q = {
                    eq: (field: string, value: string) => {
                      if (field === "handle") handle = value;
                      return q;
                    },
                  };
                  builder?.(q);
                  return {
                    unique: vi.fn(async () => {
                      if (handle === "owner") return { _id: "users:owner", handle: "owner" };
                      return null;
                    }),
                  };
                },
              ),
            };
          }
          if (table === "publishers") {
            return {
              withIndex: vi.fn(
                (
                  indexName: string,
                  builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
                ) => {
                  let handle = "";
                  let linkedUserId = "";
                  const q = {
                    eq: (field: string, value: string) => {
                      if (field === "handle") handle = value;
                      if (field === "linkedUserId") linkedUserId = value;
                      return q;
                    },
                  };
                  builder?.(q);
                  return {
                    unique: vi.fn(async () => {
                      if (indexName === "by_handle" && handle === "jaredforreal") {
                        return {
                          _id: "publishers:jaredforreal",
                          _creationTime: 1,
                          kind: "user",
                          handle: "jaredforreal",
                          displayName: "Jared",
                          linkedUserId: "users:jared",
                          trustedPublisher: false,
                          createdAt: 1,
                          updatedAt: 1,
                        };
                      }
                      if (indexName === "by_linked_user" && linkedUserId === "users:jared") {
                        return {
                          _id: "publishers:jaredforreal",
                          _creationTime: 1,
                          kind: "user",
                          handle: "jaredforreal",
                          displayName: "Jared",
                          linkedUserId: "users:jared",
                          trustedPublisher: false,
                          createdAt: 1,
                          updatedAt: 1,
                        };
                      }
                      return null;
                    }),
                  };
                },
              ),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
        insert,
        patch: vi.fn(),
        delete: vi.fn(),
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    await expect(
      addMemberHandler(
        ctx as never,
        { publisherId: "publishers:org", userHandle: "jaredforreal", role: "admin" } as never,
      ),
    ).resolves.toEqual({ ok: true });

    expect(insert).toHaveBeenCalledWith(
      "publisherMembers",
      expect.objectContaining({
        publisherId: "publishers:org",
        userId: "users:jared",
        role: "admin",
      }),
    );
  });

  it("lets org admins update org profile fields", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:admin" as never);
    const patch = vi.fn(async () => {});
    const insert = vi.fn(async () => "auditLogs:1");
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:admin") return { _id: id };
          if (id === "publishers:org") {
            return {
              _id: id,
              kind: "org",
              handle: "shopify",
              displayName: "Shopify",
              image: undefined,
              bio: undefined,
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue({
                  _id: "publisherMembers:admin",
                  publisherId: "publishers:org",
                  userId: "users:admin",
                  role: "admin",
                }),
              })),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
        patch,
        insert,
        delete: vi.fn(),
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    await expect(
      updateProfileHandler(
        ctx as never,
        {
          publisherId: "publishers:org",
          displayName: "Shopify",
          bio: "Commerce platform",
          image: "https://cdn.example.com/shopify.png",
        } as never,
      ),
    ).resolves.toEqual({
      ok: true,
      publisher: expect.objectContaining({
        _id: "publishers:org",
        displayName: "Shopify",
      }),
    });

    expect(patch).toHaveBeenCalledWith(
      "publishers:org",
      expect.objectContaining({
        displayName: "Shopify",
        bio: "Commerce platform",
        image: "https://cdn.example.com/shopify.png",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "publisher.profile.update",
        targetId: "publishers:org",
      }),
    );
  });

  it("rejects invalid org profile image URLs", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:admin" as never);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:admin") return { _id: id };
          if (id === "publishers:org") {
            return {
              _id: id,
              kind: "org",
              handle: "shopify",
              displayName: "Shopify",
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue({
                  _id: "publisherMembers:admin",
                  publisherId: "publishers:org",
                  userId: "users:admin",
                  role: "admin",
                }),
              })),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
        patch: vi.fn(),
        insert: vi.fn(),
        delete: vi.fn(),
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    await expect(
      updateProfileHandler(
        ctx as never,
        {
          publisherId: "publishers:org",
          displayName: "Shopify",
          image: "not-a-url",
        } as never,
      ),
    ).rejects.toThrow("Image must be a valid URL");
  });
});

describe("publisher audit logs", () => {
  it("audits org trusted-publisher changes", async () => {
    const patch = vi.fn();
    const insert = vi.fn(async () => "auditLogs:1");
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:admin") return { _id: id, role: "admin" };
          if (id === "publishers:openclaw") {
            return {
              _id: id,
              kind: "org",
              handle: "openclaw",
              trustedPublisher: false,
            };
          }
          return null;
        }),
        patch,
        insert,
        query: vi.fn(),
        delete: vi.fn(),
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    await setTrustedPublisherInternalHandler(ctx, {
      actorUserId: "users:admin",
      publisherId: "publishers:openclaw",
      trustedPublisher: true,
    });

    expect(patch).toHaveBeenCalledWith("publishers:openclaw", {
      trustedPublisher: true,
      updatedAt: expect.any(Number),
    });
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "publisher.trusted.set",
        actorUserId: "users:admin",
        targetType: "publisher",
        targetId: "publishers:openclaw",
        metadata: {
          handle: "openclaw",
          previousTrustedPublisher: false,
          trustedPublisher: true,
        },
      }),
    );
  });
});

describe("publisher-owned resource authorization", () => {
  function makeOwnerResourceCtx(options: {
    publisher: Record<string, unknown> | null;
    membership?: Record<string, unknown> | null;
  }) {
    return {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publishers:owner") return options.publisher;
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue(options.membership ?? null),
              })),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };
  }

  it("does not let stale ownerUserId bypass org ownership", async () => {
    const ctx = makeOwnerResourceCtx({
      publisher: { _id: "publishers:owner", kind: "org", handle: "opik" },
    });

    await expect(
      assertCanManageOwnedResource(
        ctx as never,
        {
          actor: { _id: "users:vincent" },
          ownerUserId: "users:vincent",
          ownerPublisherId: "publishers:owner",
        } as never,
      ),
    ).rejects.toThrow("Forbidden");
  });

  it("keeps linked users authorized for personal publishers", async () => {
    const ctx = makeOwnerResourceCtx({
      publisher: {
        _id: "publishers:owner",
        kind: "user",
        handle: "vincentkoc",
        linkedUserId: "users:vincent",
      },
    });

    await expect(
      assertCanManageOwnedResource(
        ctx as never,
        {
          actor: { _id: "users:vincent" },
          ownerUserId: "users:vincent",
          ownerPublisherId: "publishers:owner",
        } as never,
      ),
    ).resolves.toBeUndefined();
  });
});

describe("publisher bootstrap", () => {
  function makeSynthesizedPublisherCtx(userId: string, user: Record<string, unknown>) {
    return {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === userId) return { _id: id, ...user };
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName !== "by_user") throw new Error(`unexpected index ${indexName}`);
                return { collect: vi.fn().mockResolvedValue([]) };
              }),
            };
          }
          if (table === "publishers") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName !== "by_linked_user") {
                  throw new Error(`unexpected index ${indexName}`);
                }
                return { unique: vi.fn().mockResolvedValue(null) };
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };
  }

  it("lists a synthesized personal publisher when membership rows are missing", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:alice" as never);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:alice") {
            return {
              _id: id,
              _creationTime: 1,
              handle: "alice",
              displayName: "Alice",
              trustedPublisher: false,
              createdAt: 1,
              updatedAt: 1,
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName !== "by_user") throw new Error(`unexpected index ${indexName}`);
                return { collect: vi.fn().mockResolvedValue([]) };
              }),
            };
          }
          if (table === "publishers") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName !== "by_linked_user") {
                  throw new Error(`unexpected index ${indexName}`);
                }
                return { unique: vi.fn().mockResolvedValue(null) };
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(listMineHandler(ctx as never, {} as never)).resolves.toEqual([
      expect.objectContaining({
        role: "owner",
        publisher: expect.objectContaining({
          handle: "alice",
          kind: "user",
          linkedUserId: "users:alice",
        }),
      }),
    ]);
  });

  it("derives route-safe handles for synthesized personal publishers", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:local" as never);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:local") {
            return {
              _id: id,
              _creationTime: 1,
              name: "Local Owner",
              displayName: "Local Owner",
              trustedPublisher: false,
              createdAt: 1,
              updatedAt: 1,
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName !== "by_user") throw new Error(`unexpected index ${indexName}`);
                return { collect: vi.fn().mockResolvedValue([]) };
              }),
            };
          }
          if (table === "publishers") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName !== "by_linked_user") {
                  throw new Error(`unexpected index ${indexName}`);
                }
                return { unique: vi.fn().mockResolvedValue(null) };
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(listMineHandler(ctx as never, {} as never)).resolves.toEqual([
      expect.objectContaining({
        role: "owner",
        publisher: expect.objectContaining({
          displayName: "Local Owner",
          handle: "local-owner",
          kind: "user",
          linkedUserId: "users:local",
        }),
      }),
    ]);
  });

  it("falls back when synthesized personal publisher handles sanitize to empty", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:symbols" as never);
    const ctx = makeSynthesizedPublisherCtx("users:symbols", {
      _creationTime: 1,
      name: "!!!",
      displayName: "!!!",
      trustedPublisher: false,
      createdAt: 1,
      updatedAt: 1,
    });

    await expect(listMineHandler(ctx as never, {} as never)).resolves.toEqual([
      expect.objectContaining({
        role: "owner",
        publisher: expect.objectContaining({
          displayName: "!!!",
          handle: "user",
          kind: "user",
          linkedUserId: "users:symbols",
        }),
      }),
    ]);
  });
});

describe("self-serve org publisher creation", () => {
  function makeCreateOrgPublisherCtx(options: {
    existingPublisher?: Record<string, unknown> | null;
    existingUser?: Record<string, unknown> | null;
    reservedHandle?: Record<string, unknown> | null;
    actor?: Record<string, unknown> | null;
  }) {
    const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
    const query = vi.fn((table: string) => {
      if (table === "publishers") {
        return {
          withIndex: vi.fn((indexName: string) => {
            if (indexName !== "by_handle") throw new Error(`unexpected index ${indexName}`);
            return { unique: vi.fn().mockResolvedValue(options.existingPublisher ?? null) };
          }),
        };
      }
      if (table === "users") {
        return {
          withIndex: vi.fn((indexName: string) => {
            if (indexName !== "handle") throw new Error(`unexpected index ${indexName}`);
            return { unique: vi.fn().mockResolvedValue(options.existingUser ?? null) };
          }),
        };
      }
      if (table === "reservedHandles") {
        return {
          withIndex: vi.fn((indexName: string) => {
            if (indexName !== "by_handle_active_updatedAt") {
              throw new Error(`unexpected index ${indexName}`);
            }
            return {
              order: vi.fn(() => ({
                take: vi.fn(async () => (options.reservedHandle ? [options.reservedHandle] : [])),
              })),
            };
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });
    const ctx = {
      db: {
        get: vi.fn(async (...args: string[]) => {
          const id = args.length === 2 ? args[1] : args[0];
          if (id === "users:vincent") return options.actor ?? { _id: id, handle: "vincentkoc" };
          const inserted = inserts.find((entry) => entry.value._id === id);
          if (inserted) return inserted.value;
          return null;
        }),
        query,
        insert: vi.fn(async (table: string, value: Record<string, unknown>) => {
          const id = `${table}:${inserts.length + 1}`;
          inserts.push({ table, value: { _id: id, ...value } });
          return id;
        }),
        patch: vi.fn(),
        replace: vi.fn(),
        delete: vi.fn(),
        normalizeId: vi.fn((table: string, id: string) => (id.startsWith(`${table}:`) ? id : null)),
      },
    };
    return { ctx, inserts };
  }

  it("creates an untrusted org publisher and makes the actor owner", async () => {
    const { ctx, inserts } = makeCreateOrgPublisherCtx({});

    const result = await createOrgPublisherForUserInternalHandler(ctx as never, {
      actorUserId: "users:vincent",
      handle: "Opik",
      displayName: "Opik",
    });

    expect(result).toMatchObject({
      ok: true,
      publisherId: "publishers:1",
      handle: "opik",
      created: true,
      trusted: false,
    });
    expect(inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "publishers",
          value: expect.objectContaining({
            kind: "org",
            handle: "opik",
            displayName: "Opik",
            trustedPublisher: undefined,
          }),
        }),
        expect.objectContaining({
          table: "publisherMembers",
          value: expect.objectContaining({
            publisherId: "publishers:1",
            userId: "users:vincent",
            role: "owner",
          }),
        }),
        expect.objectContaining({
          table: "auditLogs",
          value: expect.objectContaining({
            actorUserId: "users:vincent",
            action: "publisher.org.create",
            targetType: "publisher",
            targetId: "publishers:1",
          }),
        }),
      ]),
    );
  });

  it("rejects creation when the org publisher already exists", async () => {
    const { ctx } = makeCreateOrgPublisherCtx({
      existingPublisher: { _id: "publishers:opik", kind: "org", handle: "opik" },
    });

    await expect(
      createOrgPublisherForUserInternalHandler(ctx as never, {
        actorUserId: "users:vincent",
        handle: "opik",
      }),
    ).rejects.toThrow('Publisher "@opik" already exists');
  });

  it("rejects creation when the handle belongs to a user or personal publisher", async () => {
    const { ctx } = makeCreateOrgPublisherCtx({
      existingUser: { _id: "users:opik", handle: "opik" },
    });

    await expect(
      createOrgPublisherForUserInternalHandler(ctx as never, {
        actorUserId: "users:vincent",
        handle: "opik",
      }),
    ).rejects.toThrow('Handle "@opik" is already used by a user or personal publisher');
  });

  it("rejects creation when the handle belongs to a personal publisher", async () => {
    const { ctx } = makeCreateOrgPublisherCtx({
      existingPublisher: { _id: "publishers:opik", kind: "user", handle: "opik" },
    });

    await expect(
      createOrgPublisherForUserInternalHandler(ctx as never, {
        actorUserId: "users:vincent",
        handle: "opik",
      }),
    ).rejects.toThrow('Handle "@opik" is already used by a user or personal publisher');
  });

  it("rejects creation when the handle is reserved for another user", async () => {
    const { ctx } = makeCreateOrgPublisherCtx({
      reservedHandle: {
        _id: "reservedHandles:opik",
        handle: "opik",
        rightfulOwnerUserId: "users:opik",
      },
    });

    await expect(
      createOrgPublisherForUserInternalHandler(ctx as never, {
        actorUserId: "users:vincent",
        handle: "opik",
      }),
    ).rejects.toThrow('Handle "@opik" is reserved for another user');
  });

  it("allows creation when the handle is reserved for the actor", async () => {
    const { ctx } = makeCreateOrgPublisherCtx({
      reservedHandle: {
        _id: "reservedHandles:opik",
        handle: "opik",
        rightfulOwnerUserId: "users:vincent",
      },
    });

    await expect(
      createOrgPublisherForUserInternalHandler(ctx as never, {
        actorUserId: "users:vincent",
        handle: "opik",
      }),
    ).resolves.toMatchObject({ ok: true, handle: "opik" });
  });

  function makeSettingsCreateOrgCtx(options: {
    reservedHandle?: Record<string, unknown> | null;
    existingOrgPublisher?: Record<string, unknown> | null;
  }) {
    const actor = {
      _id: "users:vincent",
      _creationTime: 1,
      handle: "vincentkoc",
      displayName: "Vincent",
      personalPublisherId: "publishers:vincent",
      createdAt: 1,
      updatedAt: 1,
    };
    const personalPublisher = {
      _id: "publishers:vincent",
      _creationTime: 1,
      kind: "user",
      handle: "vincentkoc",
      displayName: "Vincent",
      linkedUserId: "users:vincent",
      createdAt: 1,
      updatedAt: 1,
    };
    const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
    const insertCounts = new Map<string, number>();
    const insertedById = new Map<string, Record<string, unknown>>();
    const query = vi.fn((table: string) => {
      if (table === "publishers") {
        return {
          withIndex: vi.fn((indexName: string, builder: (q: unknown) => unknown) => {
            const eqValues: Record<string, unknown> = {};
            builder({
              eq: vi.fn((field: string, value: unknown) => {
                eqValues[field] = value;
                return { eq: vi.fn() };
              }),
            });
            if (indexName === "by_linked_user") {
              return { unique: vi.fn().mockResolvedValue(personalPublisher) };
            }
            if (indexName !== "by_handle") throw new Error(`unexpected index ${indexName}`);
            const handle = eqValues.handle;
            const publisher =
              handle === "vincentkoc"
                ? personalPublisher
                : handle === "opik"
                  ? options.existingOrgPublisher
                  : null;
            return { unique: vi.fn().mockResolvedValue(publisher ?? null) };
          }),
        };
      }
      if (table === "publisherMembers") {
        return {
          withIndex: vi.fn((indexName: string) => {
            if (indexName !== "by_publisher_user") {
              throw new Error(`unexpected index ${indexName}`);
            }
            return { unique: vi.fn().mockResolvedValue({ _id: "publisherMembers:personal" }) };
          }),
        };
      }
      if (table === "users") {
        return {
          withIndex: vi.fn((indexName: string) => {
            if (indexName !== "handle") throw new Error(`unexpected index ${indexName}`);
            return { unique: vi.fn().mockResolvedValue(null) };
          }),
        };
      }
      if (table === "reservedHandles") {
        return {
          withIndex: vi.fn((indexName: string) => {
            if (indexName !== "by_handle_active_updatedAt") {
              throw new Error(`unexpected index ${indexName}`);
            }
            return {
              order: vi.fn(() => ({
                take: vi.fn(async () => (options.reservedHandle ? [options.reservedHandle] : [])),
              })),
            };
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });
    const ctx = {
      db: {
        get: vi.fn(async (...args: string[]) => {
          const id = args.length === 2 ? args[1] : args[0];
          if (id === actor._id) return actor;
          if (id === personalPublisher._id) return personalPublisher;
          return insertedById.get(id) ?? null;
        }),
        query,
        insert: vi.fn(async (table: string, value: Record<string, unknown>) => {
          const next = (insertCounts.get(table) ?? 0) + 1;
          insertCounts.set(table, next);
          const id = `${table}:${next}`;
          const doc = { _id: id, _creationTime: next, ...value };
          inserts.push({ table, value: doc });
          insertedById.set(id, doc);
          return id;
        }),
        patch: vi.fn(),
        replace: vi.fn(),
        delete: vi.fn(),
        normalizeId: vi.fn((table: string, id: string) => (id.startsWith(`${table}:`) ? id : null)),
      },
    };
    return { ctx, inserts };
  }

  it("rejects Settings org creation when the handle is reserved for another user", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:vincent" as never);
    const { ctx } = makeSettingsCreateOrgCtx({
      reservedHandle: {
        _id: "reservedHandles:opik",
        handle: "opik",
        rightfulOwnerUserId: "users:opik",
      },
    });

    await expect(
      createOrgHandler(ctx as never, {
        handle: "opik",
        displayName: "Opik",
      }),
    ).rejects.toThrow('Handle "@opik" is reserved for another user');
  });

  it("lets Settings org creation use handles reserved for the actor", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:vincent" as never);
    const { ctx, inserts } = makeSettingsCreateOrgCtx({
      reservedHandle: {
        _id: "reservedHandles:opik",
        handle: "opik",
        rightfulOwnerUserId: "users:vincent",
      },
    });

    await expect(
      createOrgHandler(ctx as never, {
        handle: "Opik",
        displayName: "Opik",
        bio: "Team publisher",
      }),
    ).resolves.toMatchObject({
      publisher: { handle: "opik", bio: "Team publisher" },
      role: "owner",
    });
    expect(inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "publishers",
          value: expect.objectContaining({
            kind: "org",
            handle: "opik",
            displayName: "Opik",
            bio: "Team publisher",
          }),
        }),
        expect.objectContaining({
          table: "publisherMembers",
          value: expect.objectContaining({
            userId: "users:vincent",
            role: "owner",
          }),
        }),
      ]),
    );
  });
});

describe("legacy publisher migration", () => {
  it("lets admins create a missing org publisher and add a legacy package owner as admin", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const users = new Map<string, Record<string, unknown>>([
      ["users:admin", { _id: "users:admin", role: "admin", handle: "admin" }],
      [
        "users:vincent",
        {
          _id: "users:vincent",
          handle: "vincentkoc",
          displayName: "Vincent Koc",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    ]);
    const publishers = new Map<string, Record<string, unknown>>();
    const publisherMembers: Array<Record<string, unknown>> = [];
    const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];

    const insert = vi.fn(async (table: string, value: Record<string, unknown>) => {
      const id = `${table}:${inserts.length + 1}`;
      const row = { _id: id, _creationTime: 1, ...value };
      inserts.push({ table, value: row });
      if (table === "publishers") publishers.set(id, row);
      if (table === "publisherMembers") publisherMembers.push(row);
      return id;
    });

    const query = vi.fn((table: string) => {
      if (table === "users") {
        return {
          withIndex: vi.fn(
            (
              _indexName: string,
              builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
            ) => {
              let handle = "";
              const q = {
                eq: (field: string, value: string) => {
                  if (field === "handle") handle = value;
                  return q;
                },
              };
              builder?.(q);
              return {
                unique: vi.fn(
                  async () => [...users.values()].find((user) => user.handle === handle) ?? null,
                ),
              };
            },
          ),
        };
      }
      if (table === "publishers") {
        return {
          withIndex: vi.fn(
            (
              _indexName: string,
              builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
            ) => {
              let handle = "";
              const q = {
                eq: (field: string, value: string) => {
                  if (field === "handle") handle = value;
                  return q;
                },
              };
              builder?.(q);
              return {
                unique: vi.fn(
                  async () =>
                    [...publishers.values()].find((publisher) => publisher.handle === handle) ??
                    null,
                ),
              };
            },
          ),
        };
      }
      if (table === "publisherMembers") {
        return {
          withIndex: vi.fn(
            (
              _indexName: string,
              builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
            ) => {
              let publisherId = "";
              let userId = "";
              const q = {
                eq: (field: string, value: string) => {
                  if (field === "publisherId") publisherId = value;
                  if (field === "userId") userId = value;
                  return q;
                },
              };
              builder?.(q);
              return {
                unique: vi.fn(
                  async () =>
                    publisherMembers.find(
                      (member) => member.publisherId === publisherId && member.userId === userId,
                    ) ?? null,
                ),
              };
            },
          ),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await ensureOrgPublisherHandleInternalHandler(
      {
        db: {
          get: vi.fn(async (...args: string[]) => {
            const id = args.length === 2 ? args[1] : args[0];
            const inserted = inserts.find((entry) => entry.value._id === id);
            return users.get(id) ?? publishers.get(id) ?? inserted?.value ?? null;
          }),
          query,
          insert,
          patch: vi.fn(),
          delete: vi.fn(),
          replace: vi.fn(),
          normalizeId: vi.fn(),
        },
      } as never,
      {
        actorUserId: "users:admin",
        handle: "opik",
        displayName: "Opik",
        memberHandle: "vincentkoc",
        memberRole: "admin",
      },
    );

    expect(result).toMatchObject({
      ok: true,
      handle: "opik",
      created: true,
      member: {
        userId: "users:vincent",
        handle: "vincentkoc",
        role: "admin",
      },
    });
    expect(inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "publishers",
          value: expect.objectContaining({ kind: "org", handle: "opik", displayName: "Opik" }),
        }),
        expect.objectContaining({
          table: "publisherMembers",
          value: expect.objectContaining({
            publisherId: result.publisherId,
            userId: "users:vincent",
            role: "admin",
          }),
        }),
      ]),
    );
  });

  it("converts a legacy personal publisher into an org and rehomes package ownership", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const users = new Map<string, Record<string, unknown>>([
      ["users:admin", { _id: "users:admin", role: "admin" }],
      [
        "users:openclaw",
        {
          _id: "users:openclaw",
          _creationTime: 1,
          handle: "openclaw",
          displayName: "OpenClaw",
          trustedPublisher: true,
          personalPublisherId: "publishers:openclaw",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    ]);
    const publishers = new Map<string, Record<string, unknown>>([
      [
        "publishers:openclaw",
        {
          _id: "publishers:openclaw",
          _creationTime: 1,
          kind: "user",
          handle: "openclaw",
          displayName: "OpenClaw",
          linkedUserId: "users:openclaw",
          trustedPublisher: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      [
        "publishers:openclaw-user",
        {
          _id: "publishers:openclaw-user",
          _creationTime: 1,
          kind: "user",
          handle: "openclaw-user",
          displayName: "OpenClaw User",
          linkedUserId: "users:openclaw",
          trustedPublisher: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    ]);
    const packages = [
      {
        _id: "packages:demo",
        ownerUserId: "users:openclaw",
        ownerPublisherId: undefined,
        updatedAt: 1,
      },
    ];
    const publisherMembers = [
      {
        _id: "publisherMembers:openclaw-owner",
        publisherId: "publishers:openclaw",
        userId: "users:openclaw",
        role: "owner",
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
      if (users.has(id)) {
        users.set(id, { ...users.get(id), ...value });
        return;
      }
      if (publishers.has(id)) {
        publishers.set(id, { ...publishers.get(id), ...value });
        return;
      }
      const pkg = packages.find((entry) => entry._id === id);
      if (pkg) {
        Object.assign(pkg, value);
        return;
      }
      const member = publisherMembers.find((entry) => entry._id === id);
      if (member) {
        Object.assign(member, value);
        return;
      }
      throw new Error(`unexpected patch ${id}`);
    });

    const insert = vi.fn(async (table: string, value: Record<string, unknown>) => {
      if (table === "publishers") {
        const id = "publishers:openclaw-user";
        publishers.set(id, { _id: id, _creationTime: 1, ...value });
        return id;
      }
      if (table === "publisherMembers") {
        const id = `publisherMembers:${publisherMembers.length + 1}`;
        publisherMembers.push({
          _id: id,
          publisherId: String(value.publisherId),
          userId: String(value.userId),
          role: String(value.role),
          createdAt: Number(value.createdAt),
          updatedAt: Number(value.updatedAt),
        });
        return id;
      }
      if (table === "auditLogs") return "auditLogs:1";
      throw new Error(`unexpected insert ${table}`);
    });

    const query = vi.fn((table: string) => {
      if (table === "users") {
        return {
          withIndex: vi.fn(
            (
              _indexName: string,
              builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
            ) => {
              let handle = "";
              const q = {
                eq: (field: string, value: string) => {
                  if (field === "handle") handle = value;
                  return q;
                },
              };
              builder?.(q);
              return {
                unique: vi.fn(
                  async () => [...users.values()].find((user) => user.handle === handle) ?? null,
                ),
              };
            },
          ),
        };
      }
      if (table === "publishers") {
        return {
          withIndex: vi.fn(
            (
              _indexName: string,
              builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
            ) => {
              let handle = "";
              let linkedUserId = "";
              const q = {
                eq: (field: string, value: string) => {
                  if (field === "handle") handle = value;
                  if (field === "linkedUserId") linkedUserId = value;
                  return q;
                },
              };
              builder?.(q);
              return {
                unique: vi.fn(async () => {
                  if (handle) {
                    return (
                      [...publishers.values()].find((publisher) => publisher.handle === handle) ??
                      null
                    );
                  }
                  if (linkedUserId) {
                    return (
                      [...publishers.values()].find(
                        (publisher) => publisher.linkedUserId === linkedUserId,
                      ) ?? null
                    );
                  }
                  return null;
                }),
              };
            },
          ),
        };
      }
      if (table === "publisherMembers") {
        return {
          withIndex: vi.fn(
            (
              _indexName: string,
              builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
            ) => {
              let publisherId = "";
              let userId = "";
              const q = {
                eq: (field: string, value: string) => {
                  if (field === "publisherId") publisherId = value;
                  if (field === "userId") userId = value;
                  return q;
                },
              };
              builder?.(q);
              return {
                unique: vi.fn(
                  async () =>
                    publisherMembers.find(
                      (member) => member.publisherId === publisherId && member.userId === userId,
                    ) ?? null,
                ),
              };
            },
          ),
        };
      }
      if (table === "packages") {
        return {
          withIndex: vi.fn(
            (
              _indexName: string,
              builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
            ) => {
              let ownerUserId = "";
              let ownerPublisherId = "";
              const q = {
                eq: (field: string, value: string) => {
                  if (field === "ownerUserId") ownerUserId = value;
                  if (field === "ownerPublisherId") ownerPublisherId = value;
                  return q;
                },
              };
              builder?.(q);
              return {
                collect: vi.fn(async () => {
                  if (ownerUserId) {
                    return packages.filter((pkg) => pkg.ownerUserId === ownerUserId);
                  }
                  if (ownerPublisherId) {
                    return packages.filter((pkg) => pkg.ownerPublisherId === ownerPublisherId);
                  }
                  return [];
                }),
              };
            },
          ),
        };
      }
      if (table === "skills") {
        return {
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () => []),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await migrateLegacyPublisherHandleToOrgInternalHandler(
      {
        db: {
          get: vi.fn(async (id: string) => users.get(id) ?? publishers.get(id) ?? null),
          query,
          patch,
          insert,
          delete: vi.fn(),
          replace: vi.fn(),
          normalizeId: vi.fn(),
        },
      } as never,
      {
        actorUserId: "users:admin",
        handle: "openclaw",
        fallbackUserHandle: "openclaw-user",
        displayName: "OpenClaw",
      } as never,
    );

    expect(result).toMatchObject({
      ok: true,
      handle: "openclaw",
      orgPublisherId: "publishers:openclaw",
      legacyUserId: "users:openclaw",
      fallbackUserHandle: "openclaw-user",
      personalPublisherId: "publishers:openclaw-user",
      convertedExistingPublisher: true,
      packagesMigrated: 1,
    });
    expect(users.get("users:openclaw")).toEqual(
      expect.objectContaining({
        handle: "openclaw-user",
        personalPublisherId: "publishers:openclaw-user",
      }),
    );
    expect(publishers.get("publishers:openclaw")).toEqual(
      expect.objectContaining({
        kind: "org",
        handle: "openclaw",
        linkedUserId: undefined,
      }),
    );
    expect(publishers.get("publishers:openclaw-user")).toEqual(
      expect.objectContaining({
        kind: "user",
        handle: "openclaw-user",
        linkedUserId: "users:openclaw",
      }),
    );
    expect(packages[0]).toEqual(
      expect.objectContaining({
        ownerPublisherId: "publishers:openclaw",
      }),
    );
  });
});
