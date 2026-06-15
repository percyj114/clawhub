/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import {
  computeRecommendationScore,
  RECOMMENDATION_SCORE_VERSION,
} from "./lib/recommendationScore";
import {
  processPackageStatEventsInternal,
  recordPackageDownloadInternal,
  recordPackageInstallInternal,
} from "./packages";

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const recordDownloadHandler = (
  recordPackageDownloadInternal as unknown as WrappedHandler<{ packageId: string }, void>
)._handler;

const recordInstallHandler = (
  recordPackageInstallInternal as unknown as WrappedHandler<
    {
      packageId: string;
      identityKind: "user" | "ip";
      identityHash: string;
      dayStart: number;
      occurredAt: number;
    },
    void
  >
)._handler;

const processStatsHandler = (
  processPackageStatEventsInternal as unknown as WrappedHandler<
    { batchSize?: number },
    { processed: number; packagesUpdated: number }
  >
)._handler;

describe("package stat events", () => {
  it("records downloads as append-only events", async () => {
    const insert = vi.fn();

    await recordDownloadHandler(
      {
        db: {
          query: vi.fn(),
          get: vi.fn(),
          normalizeId: vi.fn(),
          insert,
          patch: vi.fn(),
          replace: vi.fn(),
          delete: vi.fn(),
          system: {
            get: vi.fn(),
            query: vi.fn(),
          },
        },
      },
      {
        packageId: "packages:one",
      },
    );

    expect(insert).toHaveBeenCalledWith(
      "packageStatEvents",
      expect.objectContaining({
        packageId: "packages:one",
        kind: "download",
        processedAt: undefined,
      }),
    );
  });

  it("records identity-backed installs as append-only events", async () => {
    const insert = vi.fn();
    const unique = vi.fn().mockResolvedValue(null);
    const queryBuilder = {
      eq: vi.fn(() => queryBuilder),
    };
    const withIndex = vi.fn((_indexName: string, buildQuery: (q: unknown) => unknown) => {
      buildQuery(queryBuilder);
      return { unique };
    });

    await recordInstallHandler(
      {
        db: {
          query: vi.fn(() => ({ withIndex })),
          get: vi.fn(),
          normalizeId: vi.fn(),
          insert,
          patch: vi.fn(),
          replace: vi.fn(),
          delete: vi.fn(),
          system: {
            get: vi.fn(),
            query: vi.fn(),
          },
        },
      },
      {
        packageId: "packages:one",
        identityKind: "ip",
        identityHash: "hash-ip",
        dayStart: 86_400_000,
        occurredAt: 86_500_000,
      },
    );

    expect(insert).toHaveBeenCalledWith(
      "packageStatEvents",
      expect.objectContaining({
        packageId: "packages:one",
        kind: "install",
        occurredAt: 86_500_000,
        processedAt: undefined,
      }),
    );
  });

  it("dedupes identity-backed installs before appending stat events", async () => {
    const insert = vi.fn();
    const unique = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
      _id: "packageInstallMetricDedupes:existing",
    });
    const queryBuilder = {
      eq: vi.fn(() => queryBuilder),
    };
    const withIndex = vi.fn((_indexName: string, buildQuery: (q: unknown) => unknown) => {
      buildQuery(queryBuilder);
      return { unique };
    });
    const ctx = {
      db: {
        query: vi.fn(() => ({ withIndex })),
        get: vi.fn(),
        normalizeId: vi.fn(),
        insert,
        patch: vi.fn(),
        replace: vi.fn(),
        delete: vi.fn(),
        system: {
          get: vi.fn(),
          query: vi.fn(),
        },
      },
    };
    const args = {
      packageId: "packages:one",
      identityKind: "ip" as const,
      identityHash: "hash-ip",
      dayStart: 86_400_000,
      occurredAt: 86_500_000,
    };

    await recordInstallHandler(ctx, args);
    await recordInstallHandler(ctx, args);

    expect(withIndex).toHaveBeenCalledWith("by_target_metric_identity_day", expect.any(Function));
    expect(queryBuilder.eq).toHaveBeenCalledWith("targetKind", "package");
    expect(queryBuilder.eq).toHaveBeenCalledWith("targetId", "packages:one");
    expect(queryBuilder.eq).toHaveBeenCalledWith("metricKind", "install");
    expect(queryBuilder.eq).toHaveBeenCalledWith("identityKind", "ip");
    expect(queryBuilder.eq).toHaveBeenCalledWith("identityHash", "hash-ip");
    expect(queryBuilder.eq).toHaveBeenCalledWith("dayStart", 86_400_000);
    expect(insert).toHaveBeenCalledWith(
      "packageInstallMetricDedupes",
      expect.objectContaining({
        targetKind: "package",
        targetId: "packages:one",
        metricKind: "install",
        identityKind: "ip",
        identityHash: "hash-ip",
        dayStart: 86_400_000,
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "packageStatEvents",
      expect.objectContaining({
        packageId: "packages:one",
        kind: "install",
        occurredAt: 86_500_000,
      }),
    );
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("aggregates queued downloads and installs before patching package stats", async () => {
    const events = [
      { _id: "packageStatEvents:1", packageId: "packages:one", kind: "download" },
      { _id: "packageStatEvents:2", packageId: "packages:one", kind: "install" },
      { _id: "packageStatEvents:3", packageId: "packages:two", kind: "download" },
    ];
    const patch = vi.fn();
    const insert = vi.fn();
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === "packageStatEvents") {
            return {
              withIndex: vi.fn(() => ({
                take: vi.fn(async () => events),
              })),
            };
          }
          if (table === "packageSearchDigest") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue(null),
              })),
            };
          }
          if (
            table === "packageCapabilitySearchDigest" ||
            table === "packagePluginCategorySearchDigest"
          ) {
            return {
              withIndex: vi.fn(() => ({
                collect: vi.fn().mockResolvedValue([]),
              })),
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        }),
        get: vi.fn(async (id: string) =>
          makeStatsPackageDoc(id, { downloads: 10, installs: 1, stars: 2, versions: 3 }),
        ),
        normalizeId: vi.fn(),
        insert,
        patch,
        replace: vi.fn(),
        delete: vi.fn(),
        system: {
          get: vi.fn(),
          query: vi.fn(),
        },
      },
      scheduler: {
        runAfter: vi.fn(),
      },
    };

    const result = await processStatsHandler(ctx, { batchSize: 10 });

    expect(result).toEqual({ processed: 3, packagesUpdated: 2 });
    expect(patch).toHaveBeenCalledWith(
      "packages:one",
      expect.objectContaining({
        stats: expect.objectContaining({ downloads: 11 }),
        recommendedScore: computeRecommendationScore({
          downloads: 11,
          installs: 2,
          stars: 2,
        }),
        recommendedScoreVersion: RECOMMENDATION_SCORE_VERSION,
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "packages:one",
      expect.objectContaining({
        stats: expect.objectContaining({ installs: 2 }),
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "packages:two",
      expect.objectContaining({
        stats: expect.objectContaining({ downloads: 11 }),
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "packageStatEvents:1",
      expect.objectContaining({ processedAt: expect.any(Number) }),
    );
  });

  it("syncs package search digest stats after processing install events", async () => {
    const events = [{ _id: "packageStatEvents:1", packageId: "packages:one", kind: "install" }];
    const patch = vi.fn();
    const packageDoc = makeStatsPackageDoc("packages:one", {
      downloads: 10,
      installs: 1,
      stars: 2,
      versions: 3,
      capabilityTags: ["tools"],
    });
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === "packageStatEvents") {
            return {
              withIndex: vi.fn(() => ({
                take: vi.fn(async () => events),
              })),
            };
          }
          if (table === "packageSearchDigest") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue({
                  _id: "packageSearchDigest:one",
                  packageId: "packages:one",
                  stats: { downloads: 10, installs: 1, stars: 2, versions: 3 },
                }),
              })),
            };
          }
          if (table === "packageCapabilitySearchDigest") {
            return {
              withIndex: vi.fn(() => ({
                collect: vi.fn().mockResolvedValue([
                  {
                    _id: "packageCapabilitySearchDigest:one-tools",
                    packageId: "packages:one",
                    capabilityTag: "tools",
                    ownerHandle: "owner",
                    ownerKind: "user",
                    stats: { downloads: 10, installs: 1, stars: 2, versions: 3 },
                  },
                ]),
              })),
            };
          }
          if (table === "packagePluginCategorySearchDigest") {
            return {
              withIndex: vi.fn(() => ({
                collect: vi.fn().mockResolvedValue([]),
              })),
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        }),
        get: vi.fn(async (id: string) => (id === "packages:one" ? packageDoc : null)),
        normalizeId: vi.fn(),
        insert: vi.fn(),
        patch,
        replace: vi.fn(),
        delete: vi.fn(),
        system: {
          get: vi.fn(),
          query: vi.fn(),
        },
      },
      scheduler: {
        runAfter: vi.fn(),
      },
    };

    await processStatsHandler(ctx, { batchSize: 10 });

    expect(patch).toHaveBeenCalledWith(
      "packageSearchDigest:one",
      expect.objectContaining({
        stats: expect.objectContaining({ installs: 2 }),
      }),
    );
    expect(patch).toHaveBeenCalledWith("packageCapabilitySearchDigest:one-tools", {
      stats: { downloads: 10, installs: 2, stars: 2, versions: 3 },
    });
  });
});

function makeStatsPackageDoc(
  id: string,
  overrides: Partial<{
    downloads: number;
    installs: number;
    stars: number;
    versions: number;
    capabilityTags: string[];
  }> = {},
) {
  const name = id.replace("packages:", "demo-");
  return {
    _id: id,
    name,
    normalizedName: name,
    displayName: name,
    family: "code-plugin",
    channel: "community",
    isOfficial: false,
    ownerUserId: "users:owner",
    ownerPublisherId: undefined,
    tags: {},
    latestReleaseId: "packageReleases:demo-1",
    latestVersionSummary: { version: "1.0.0" },
    compatibility: null,
    capabilities: null,
    verification: null,
    scanStatus: "clean",
    capabilityTags: overrides.capabilityTags ?? [],
    stats: {
      downloads: overrides.downloads ?? 0,
      installs: overrides.installs ?? 0,
      stars: overrides.stars ?? 0,
      versions: overrides.versions ?? 1,
    },
    createdAt: 1,
    updatedAt: 1,
    softDeletedAt: undefined,
  };
}
