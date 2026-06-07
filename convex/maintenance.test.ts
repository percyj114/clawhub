/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

vi.mock("./_generated/api", () => ({
  internal: {
    maintenance: {
      getSkillBackfillPageInternal: Symbol("getSkillBackfillPageInternal"),
      applySkillBackfillPatchInternal: Symbol("applySkillBackfillPatchInternal"),
      backfillSkillSummariesInternal: Symbol("backfillSkillSummariesInternal"),
      getUserStatsBackfillPageInternal: Symbol("getUserStatsBackfillPageInternal"),
      getUserOwnedSkillsBackfillPageInternal: Symbol("getUserOwnedSkillsBackfillPageInternal"),
      applyUserStatsBackfillPatchInternal: Symbol("applyUserStatsBackfillPatchInternal"),
      backfillUserStatsInternal: Symbol("backfillUserStatsInternal"),
      getPublisherStatsBackfillPageInternal: Symbol("getPublisherStatsBackfillPageInternal"),
      recomputePublisherStatsInternal: Symbol("recomputePublisherStatsInternal"),
      backfillPublisherStatsInternal: Symbol("backfillPublisherStatsInternal"),
      getSkillFingerprintBackfillPageInternal: Symbol("getSkillFingerprintBackfillPageInternal"),
      applySkillFingerprintBackfillPatchInternal: Symbol(
        "applySkillFingerprintBackfillPatchInternal",
      ),
      backfillSkillFingerprintsInternal: Symbol("backfillSkillFingerprintsInternal"),
      applySkillCapabilityTagsInternal: Symbol("applySkillCapabilityTagsInternal"),
      backfillSkillCapabilityTagsInternal: Symbol("backfillSkillCapabilityTagsInternal"),
      getDependencyRegistryScanCleanupPageInternal: Symbol(
        "getDependencyRegistryScanCleanupPageInternal",
      ),
      applyDependencyRegistryScanCleanupInternal: Symbol(
        "applyDependencyRegistryScanCleanupInternal",
      ),
      backfillDigestVersionSummary: Symbol("backfillDigestVersionSummary"),
      getEmptySkillCleanupPageInternal: Symbol("getEmptySkillCleanupPageInternal"),
      applyEmptySkillCleanupInternal: Symbol("applyEmptySkillCleanupInternal"),
      nominateUserForEmptySkillSpamInternal: Symbol("nominateUserForEmptySkillSpamInternal"),
      cleanupEmptySkillsInternal: Symbol("cleanupEmptySkillsInternal"),
      nominateEmptySkillSpammersInternal: Symbol("nominateEmptySkillSpammersInternal"),
      repairLegacyPublisherOwnership: Symbol("repairLegacyPublisherOwnership"),
    },
    skills: {
      backfillLatestSkillModerationInternal: Symbol("skills.backfillLatestSkillModerationInternal"),
      getVersionByIdInternal: Symbol("skills.getVersionByIdInternal"),
      getOwnerSkillActivityInternal: Symbol("skills.getOwnerSkillActivityInternal"),
    },
    skillCards: {
      enqueueForVersionInternal: Symbol("skillCards.enqueueForVersionInternal"),
    },
    users: {
      getByIdInternal: Symbol("users.getByIdInternal"),
    },
  },
}));

vi.mock("./lib/skillSummary", () => ({
  generateSkillSummary: vi.fn(),
}));

const {
  applyDependencyRegistryScanCleanupInternalHandler,
  applySkillCapabilityTagsInternal,
  backfillDigestVersionSummary,
  backfillLatestVersionSummaryInternal,
  backfillPublisherStatsInternalHandler,
  backfillSkillSearchDigestInternal,
  backfillSkillFingerprintsInternalHandler,
  backfillSkillSummariesInternalHandler,
  backfillUserStatsInternalHandler,
  cleanupEmptySkillsInternalHandler,
  cleanupDependencyRegistryScanDataInternalHandler,
  nominateEmptySkillSpammersInternalHandler,
  repairLegacyPublisherOwnershipForUserHandler,
  repairLegacyPublisherOwnershipHandler,
  hasLegacyDependencyRegistrySkillModeration,
  stripDependencyRegistryStaticScan,
  upsertSkillBadgeRecordInternal,
} = await import("./maintenance");
const { internal } = await import("./_generated/api");
const { generateSkillSummary } = await import("./lib/skillSummary");

function makeBlob(text: string) {
  return { text: () => Promise.resolve(text) } as unknown as Blob;
}

function makeSkillSearchDigestQuery(
  existingDigest: Record<string, unknown> | null,
  existingGlobalStats: Record<string, unknown> | null = null,
) {
  const queryBuilder = {
    eq: vi.fn(() => queryBuilder),
  };
  const skillDigestUnique = vi.fn(async () => existingDigest);
  const globalStatsUnique = vi.fn(async () => existingGlobalStats);
  const withIndex = vi.fn(
    (_indexName: string, indexBuilder: (q: typeof queryBuilder) => unknown) => {
      indexBuilder(queryBuilder);
      return { unique: skillDigestUnique };
    },
  );
  const globalStatsWithIndex = vi.fn(
    (_indexName: string, indexBuilder: (q: typeof queryBuilder) => unknown) => {
      indexBuilder(queryBuilder);
      return { unique: globalStatsUnique };
    },
  );
  const query = vi.fn((tableName: string) => {
    if (tableName === "skillSearchDigest") {
      return { withIndex };
    }
    if (tableName === "globalStats") {
      return { withIndex: globalStatsWithIndex };
    }
    throw new Error(`Unexpected table query: ${tableName}`);
  });
  return { query, withIndex, skillDigestUnique, globalStatsWithIndex, globalStatsUnique };
}

describe("maintenance dependency registry scan cleanup", () => {
  it("matches legacy dependency registry moderation stored only in evidence", () => {
    expect(
      hasLegacyDependencyRegistrySkillModeration({
        moderationReasonCodes: [],
        moderationEvidence: [
          {
            code: "suspicious.dep_not_found_on_registry",
            severity: "critical",
            file: "Dependency manifests",
            line: 1,
            message: "missing dependency",
            evidence: "legacy dependency registry evidence",
          },
        ],
      }),
    ).toBe(true);
  });

  it("strips legacy dependency registry findings from static scan snapshots", () => {
    const stripped = stripDependencyRegistryStaticScan({
      status: "suspicious",
      reasonCodes: ["suspicious.dep_not_found_on_registry"],
      findings: [
        {
          code: "suspicious.dep_not_found_on_registry",
          severity: "critical",
          file: "Dependency manifests",
          line: 1,
          message: "missing dependency",
          evidence: "legacy dependency registry evidence",
        },
      ],
      summary: "Detected: suspicious.dep_not_found_on_registry",
      engineVersion: "test",
      checkedAt: 123,
    });

    expect(stripped).toMatchObject({
      status: "clean",
      reasonCodes: [],
      findings: [],
      summary: "No suspicious patterns detected.",
      engineVersion: "test",
      checkedAt: 123,
    });
  });

  it("dry-runs dependency registry cleanup without writes", async () => {
    const runQuery = vi.fn(async () => ({
      versionItems: [
        {
          id: "skillVersions:legacy",
          hasDepRegistryAnalysis: true,
          hasDepRegistryScanStatus: true,
          hasLegacyStaticScan: true,
        },
        {
          id: "skillVersions:static-only",
          hasDepRegistryAnalysis: false,
          hasDepRegistryScanStatus: false,
          hasLegacyStaticScan: true,
        },
      ],
      skillItems: [
        {
          id: "skills:legacy",
          hasLegacyModeration: true,
        },
      ],
      cacheRowIds: ["depRegistryCache:1"],
      versionCursor: null,
      skillCursor: null,
      cacheCursor: null,
      versionsDone: true,
      skillsDone: true,
      cacheDone: true,
    }));
    const runMutation = vi.fn();

    const result = await cleanupDependencyRegistryScanDataInternalHandler(
      { runQuery, runMutation } as never,
      { dryRun: true, batchSize: 10, maxBatches: 1 },
    );

    expect(result).toEqual({
      ok: true,
      dryRun: true,
      stats: {
        versionRowsScanned: 2,
        versionRowsMatched: 2,
        staticScansMatched: 2,
        skillRowsScanned: 1,
        skillRowsMatched: 1,
        versionRowsPatched: 0,
        staticScansRewritten: 0,
        skillRowsPatched: 0,
        cacheRowsScanned: 1,
        cacheRowsDeleted: 0,
      },
      cursors: { versionCursor: null, skillCursor: null, cacheCursor: null },
      done: { versionsDone: true, skillsDone: true, cacheDone: true },
      isDone: true,
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("dry-runs dependency registry cleanup by default", async () => {
    const runQuery = vi.fn(async () => ({
      versionItems: [
        {
          id: "skillVersions:legacy",
          hasDepRegistryAnalysis: true,
          hasDepRegistryScanStatus: true,
          hasLegacyStaticScan: true,
        },
      ],
      skillItems: [],
      cacheRowIds: ["depRegistryCache:1"],
      versionCursor: null,
      skillCursor: null,
      cacheCursor: null,
      versionsDone: true,
      skillsDone: true,
      cacheDone: true,
    }));
    const runMutation = vi.fn();

    const result = await cleanupDependencyRegistryScanDataInternalHandler(
      { runQuery, runMutation } as never,
      { batchSize: 10, maxBatches: 1 },
    );

    expect(result.dryRun).toBe(true);
    expect(result.stats.versionRowsMatched).toBe(1);
    expect(result.stats.skillRowsScanned).toBe(0);
    expect(result.stats.cacheRowsScanned).toBe(1);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("requires an explicit confirmation token before applying dependency registry cleanup", async () => {
    await expect(
      cleanupDependencyRegistryScanDataInternalHandler({ runQuery: vi.fn() } as never, {
        dryRun: false,
      }),
    ).rejects.toThrow(/confirm/i);
  });

  it("applies dependency registry cleanup in batches after explicit confirmation", async () => {
    const runQuery = vi.fn(async () => ({
      versionItems: [
        {
          id: "skillVersions:legacy",
          hasDepRegistryAnalysis: true,
          hasDepRegistryScanStatus: true,
          hasLegacyStaticScan: true,
        },
      ],
      skillItems: [
        {
          id: "skills:legacy",
          hasLegacyModeration: true,
        },
      ],
      cacheRowIds: ["depRegistryCache:1"],
      versionCursor: "next-version",
      skillCursor: "next-skill",
      cacheCursor: null,
      versionsDone: false,
      skillsDone: false,
      cacheDone: true,
    }));
    const runMutation = vi.fn(async () => ({
      versionRowsPatched: 1,
      staticScansRewritten: 1,
      skillRowsPatched: 1,
      cacheRowsDeleted: 1,
    }));

    const result = await cleanupDependencyRegistryScanDataInternalHandler(
      { runQuery, runMutation } as never,
      {
        dryRun: false,
        confirm: "delete-dependency-registry-scan-data",
        batchSize: 10,
        maxBatches: 1,
        skillCursor: "start-skill",
      },
    );

    expect(result).toMatchObject({
      ok: true,
      dryRun: false,
      stats: {
        versionRowsScanned: 1,
        versionRowsMatched: 1,
        staticScansMatched: 1,
        skillRowsScanned: 1,
        skillRowsMatched: 1,
        versionRowsPatched: 1,
        staticScansRewritten: 1,
        skillRowsPatched: 1,
        cacheRowsScanned: 1,
        cacheRowsDeleted: 1,
      },
      cursors: { versionCursor: "next-version", skillCursor: "next-skill", cacheCursor: null },
      isDone: false,
    });
    expect(runQuery).toHaveBeenCalledWith(
      internal.maintenance.getDependencyRegistryScanCleanupPageInternal,
      expect.objectContaining({
        skillCursor: "start-skill",
      }),
    );
    expect(runMutation).toHaveBeenCalledWith(
      internal.maintenance.applyDependencyRegistryScanCleanupInternal,
      {
        versionIds: ["skillVersions:legacy"],
        skillIds: ["skills:legacy"],
        cacheRowIds: ["depRegistryCache:1"],
      },
    );
  });

  it("uses completed table state when resuming dependency registry cleanup", async () => {
    const runQuery = vi.fn(async () => ({
      versionItems: [],
      skillItems: [
        {
          id: "skills:legacy",
          hasLegacyModeration: true,
        },
      ],
      cacheRowIds: [],
      versionCursor: null,
      skillCursor: "next-skill",
      cacheCursor: null,
      versionsDone: true,
      skillsDone: false,
      cacheDone: true,
    }));
    const runMutation = vi.fn();

    const result = await cleanupDependencyRegistryScanDataInternalHandler(
      { runQuery, runMutation } as never,
      {
        dryRun: true,
        batchSize: 10,
        maxBatches: 1,
        versionsDone: true,
        skillCursor: "start-skill",
        cacheDone: true,
      },
    );

    expect(result).toMatchObject({
      stats: {
        versionRowsScanned: 0,
        versionRowsMatched: 0,
        staticScansMatched: 0,
        skillRowsScanned: 1,
        skillRowsMatched: 1,
        versionRowsPatched: 0,
        staticScansRewritten: 0,
        skillRowsPatched: 0,
        cacheRowsScanned: 0,
        cacheRowsDeleted: 0,
      },
      cursors: { versionCursor: null, skillCursor: "next-skill", cacheCursor: null },
      done: { versionsDone: true, skillsDone: false, cacheDone: true },
      isDone: false,
    });
    expect(runQuery).toHaveBeenCalledWith(
      internal.maintenance.getDependencyRegistryScanCleanupPageInternal,
      expect.objectContaining({
        skipVersions: true,
        skillCursor: "start-skill",
        skipSkills: false,
        skipCache: true,
      }),
    );
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("reports apply-mode cache cleanup done when the final cache page is full", async () => {
    const runQuery = vi.fn(async () => ({
      versionItems: [],
      skillItems: [],
      cacheRowIds: ["depRegistryCache:1", "depRegistryCache:2"],
      versionCursor: null,
      skillCursor: null,
      cacheCursor: null,
      versionsDone: true,
      skillsDone: true,
      cacheDone: true,
    }));
    const runMutation = vi.fn(async () => ({
      versionRowsPatched: 0,
      staticScansRewritten: 0,
      skillRowsPatched: 0,
      cacheRowsDeleted: 2,
    }));

    const result = await cleanupDependencyRegistryScanDataInternalHandler(
      { runQuery, runMutation } as never,
      {
        dryRun: false,
        confirm: "delete-dependency-registry-scan-data",
        batchSize: 2,
        maxBatches: 1,
      },
    );

    expect(result).toMatchObject({
      dryRun: false,
      cursors: { versionCursor: null, skillCursor: null, cacheCursor: null },
      isDone: true,
    });
  });

  it("clears version fields and deletes cache rows in the cleanup mutation", async () => {
    const version = {
      _id: "skillVersions:legacy",
      depRegistryAnalysis: {
        status: "suspicious",
        results: [],
        notFoundPackages: ["missing-package (npm)"],
        unresolvedPackages: [],
        summary: "Dependency advisory warning.",
        checkedAt: 456,
      },
      depRegistryScanStatus: "suspicious",
      staticScan: {
        status: "suspicious",
        reasonCodes: ["suspicious.dep_not_found_on_registry"],
        findings: [
          {
            code: "suspicious.dep_not_found_on_registry",
            severity: "critical",
            file: "Dependency manifests",
            line: 1,
            message: "missing dependency",
            evidence: "legacy dependency registry evidence",
          },
        ],
        summary: "Detected: suspicious.dep_not_found_on_registry",
        engineVersion: "test",
        checkedAt: 123,
      },
    };
    const skill = {
      _id: "skills:legacy",
      slug: "legacy",
      displayName: "Legacy",
      stats: {
        downloads: 0,
        stars: 0,
        comments: 0,
        versions: 1,
        installsCurrent: 0,
        installsAllTime: 0,
      },
      moderationReason: "scanner.aggregate.suspicious",
      moderationStatus: "hidden",
      moderationVerdict: "suspicious",
      moderationFlags: ["flagged.suspicious"],
      moderationReasonCodes: ["suspicious.dep_not_found_on_registry"],
      moderationEvidence: [
        {
          code: "suspicious.dep_not_found_on_registry",
          severity: "critical",
          file: "Dependency manifests",
          line: 1,
          message: "missing dependency",
          evidence: "legacy dependency registry evidence",
        },
      ],
      moderationSummary: "Detected: suspicious.dep_not_found_on_registry",
      isSuspicious: true,
    };
    const cacheRow = { _id: "depRegistryCache:1" };
    const get = vi.fn(async (id: string) => {
      if (id === version._id) return version;
      if (id === skill._id) return skill;
      if (id === cacheRow._id) return cacheRow;
      return null;
    });
    const patch = vi.fn(async () => {});
    const deleteRow = vi.fn(async () => {});
    const runAfter = vi.fn(async () => {});
    const { query } = makeSkillSearchDigestQuery(
      {
        _id: "skillSearchDigest:1",
        skillId: "skills:legacy",
        moderationStatus: "hidden",
        moderationReason: "scanner.aggregate.suspicious",
        moderationFlags: ["flagged.suspicious"],
        isSuspicious: true,
      },
      {
        _id: "globalStats:default",
        key: "default",
        activeSkillsCount: 12,
        updatedAt: 100,
      },
    );

    const result = await applyDependencyRegistryScanCleanupInternalHandler(
      { db: { get, patch, delete: deleteRow, query }, scheduler: { runAfter } } as never,
      {
        versionIds: ["skillVersions:legacy" as never],
        skillIds: ["skills:legacy" as never],
        cacheRowIds: ["depRegistryCache:1" as never],
      },
    );

    expect(result).toEqual({
      versionRowsPatched: 1,
      staticScansRewritten: 1,
      skillRowsPatched: 1,
      cacheRowsDeleted: 1,
    });
    expect(patch).toHaveBeenCalledWith(
      "skillVersions:legacy",
      expect.objectContaining({
        depRegistryAnalysis: undefined,
        depRegistryScanStatus: undefined,
        staticScan: expect.objectContaining({
          status: "clean",
          reasonCodes: [],
          findings: [],
          summary: "No suspicious patterns detected.",
        }),
      }),
    );
    expect(runAfter).toHaveBeenCalledWith(0, internal.skillCards.enqueueForVersionInternal, {
      versionId: "skillVersions:legacy",
      source: "scan",
    });
    expect(patch).toHaveBeenCalledWith(
      "skills:legacy",
      expect.objectContaining({
        moderationReason: "scanner.aggregate.clean",
        moderationStatus: "active",
        moderationVerdict: "clean",
        moderationFlags: undefined,
        moderationReasonCodes: undefined,
        moderationEvidence: undefined,
        moderationSummary: "No suspicious patterns detected.",
        isSuspicious: false,
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "skillSearchDigest:1",
      expect.objectContaining({
        skillId: "skills:legacy",
        moderationStatus: "active",
        moderationReason: "scanner.aggregate.clean",
        moderationFlags: undefined,
        isSuspicious: false,
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "globalStats:default",
      expect.objectContaining({
        activeSkillsCount: 13,
      }),
    );
    expect(deleteRow).toHaveBeenCalledWith("depRegistryCache:1");
  });

  it("inserts owner-hydrated search digests when cleanup unhides a legacy skill", async () => {
    const skill = {
      _id: "skills:no-digest",
      _creationTime: 900,
      slug: "no-digest",
      displayName: "No Digest",
      ownerUserId: "users:owner",
      ownerPublisherId: "publishers:openclaw",
      latestVersionId: "skillVersions:no-digest",
      latestVersionSummary: {
        version: "1.0.0",
        createdAt: 900,
        changelog: "Initial release",
      },
      tags: {},
      badges: undefined,
      stats: {
        downloads: 0,
        stars: 0,
        comments: 0,
        versions: 1,
        installsCurrent: 0,
        installsAllTime: 0,
      },
      moderationReason: "scanner.aggregate.suspicious",
      moderationStatus: "hidden",
      moderationVerdict: "suspicious",
      moderationFlags: ["flagged.suspicious"],
      moderationReasonCodes: ["suspicious.dep_not_found_on_registry"],
      moderationEvidence: [
        {
          code: "suspicious.dep_not_found_on_registry",
          severity: "critical",
          file: "Dependency manifests",
          line: 1,
          message: "missing dependency",
          evidence: "legacy dependency registry evidence",
        },
      ],
      moderationSummary: "Detected: suspicious.dep_not_found_on_registry",
      isSuspicious: true,
      createdAt: 900,
      updatedAt: 950,
    };
    const publisher = {
      _id: "publishers:openclaw",
      handle: "openclaw",
      displayName: "OpenClaw",
      image: "https://example.com/openclaw.png",
      kind: "org",
      deletedAt: undefined,
      deactivatedAt: undefined,
    };
    const version = {
      _id: "skillVersions:no-digest",
      skillId: "skills:no-digest",
      softDeletedAt: undefined,
    };
    const get = vi.fn(async (id: string) => {
      if (id === skill._id) return skill;
      if (id === version._id) return version;
      if (id === publisher._id) return publisher;
      return null;
    });
    const patch = vi.fn(async () => {});
    const insert = vi.fn(async () => "skillSearchDigest:no-digest");
    const deleteRow = vi.fn(async () => {});
    const { query } = makeSkillSearchDigestQuery(null, {
      _id: "globalStats:default",
      key: "default",
      activeSkillsCount: 12,
      updatedAt: 100,
    });

    const result = await applyDependencyRegistryScanCleanupInternalHandler(
      { db: { get, insert, patch, delete: deleteRow, query } } as never,
      {
        versionIds: [],
        skillIds: ["skills:no-digest" as never],
        cacheRowIds: [],
      },
    );

    expect(result).toEqual({
      versionRowsPatched: 0,
      staticScansRewritten: 0,
      skillRowsPatched: 1,
      cacheRowsDeleted: 0,
    });
    expect(insert).toHaveBeenCalledWith(
      "skillSearchDigest",
      expect.objectContaining({
        skillId: "skills:no-digest",
        latestVersionSkillId: "skills:no-digest",
        moderationStatus: "active",
        moderationReason: "scanner.aggregate.clean",
        moderationFlags: undefined,
        isSuspicious: false,
        ownerHandle: "openclaw",
        ownerKind: "org",
        ownerDisplayName: "OpenClaw",
        ownerImage: "https://example.com/openclaw.png",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "globalStats:default",
      expect.objectContaining({
        activeSkillsCount: 13,
      }),
    );
    expect(deleteRow).not.toHaveBeenCalled();
  });

  it("preserves owner-delete provenance when cleanup removes retired scanner-only moderation", async () => {
    const skill = {
      _id: "skills:owner-deleted",
      slug: "owner-deleted",
      displayName: "Owner Deleted",
      ownerUserId: "users:owner",
      softDeletedAt: 1_000,
      hiddenAt: 1_000,
      hiddenBy: "users:owner",
      stats: {
        downloads: 0,
        stars: 0,
        comments: 0,
        versions: 1,
        installsCurrent: 0,
        installsAllTime: 0,
      },
      moderationReason: "scanner.aggregate.suspicious",
      moderationStatus: "hidden",
      moderationVerdict: "suspicious",
      moderationFlags: ["flagged.suspicious"],
      moderationReasonCodes: ["suspicious.dep_not_found_on_registry"],
      moderationEvidence: [
        {
          code: "suspicious.dep_not_found_on_registry",
          severity: "critical",
          file: "Dependency manifests",
          line: 1,
          message: "missing dependency",
          evidence: "legacy dependency registry evidence",
        },
      ],
      moderationSummary: "Detected: suspicious.dep_not_found_on_registry",
      isSuspicious: true,
    };
    const get = vi.fn(async (id: string) => (id === skill._id ? skill : null));
    const patch = vi.fn(async (_id: string, _patch: Record<string, unknown>) => {});
    const deleteRow = vi.fn(async () => {});
    const { query } = makeSkillSearchDigestQuery({
      _id: "skillSearchDigest:1",
      skillId: "skills:owner-deleted",
      softDeletedAt: 1_000,
      moderationStatus: "hidden",
      moderationReason: "scanner.aggregate.suspicious",
      moderationFlags: ["flagged.suspicious"],
      isSuspicious: true,
    });

    const result = await applyDependencyRegistryScanCleanupInternalHandler(
      { db: { get, patch, delete: deleteRow, query } } as never,
      {
        versionIds: [],
        skillIds: ["skills:owner-deleted" as never],
        cacheRowIds: [],
      },
    );

    expect(result).toEqual({
      versionRowsPatched: 0,
      staticScansRewritten: 0,
      skillRowsPatched: 1,
      cacheRowsDeleted: 0,
    });
    const skillPatch = patch.mock.calls.find(([id]) => id === "skills:owner-deleted")?.[1];
    expect(skillPatch).toMatchObject({
      moderationReason: "scanner.aggregate.clean",
      moderationStatus: "active",
      moderationVerdict: "clean",
      moderationFlags: undefined,
      moderationReasonCodes: undefined,
      moderationEvidence: undefined,
      moderationSummary: "No suspicious patterns detected.",
      isSuspicious: false,
    });
    expect(skillPatch).not.toHaveProperty("hiddenAt");
    expect(skillPatch).not.toHaveProperty("hiddenBy");
    expect(deleteRow).not.toHaveBeenCalled();
  });

  it("preserves scanner-specific suspicious reasons when cleanup removes retired moderation", async () => {
    const skill = {
      _id: "skills:vt-suspicious",
      slug: "vt-suspicious",
      displayName: "VT Suspicious",
      ownerUserId: "users:owner",
      hiddenAt: 1_000,
      hiddenBy: "users:mod",
      stats: {
        downloads: 0,
        stars: 0,
        comments: 0,
        versions: 1,
        installsCurrent: 0,
        installsAllTime: 0,
      },
      moderationReason: "scanner.vt.suspicious",
      moderationStatus: "hidden",
      moderationVerdict: "suspicious",
      moderationFlags: ["flagged.suspicious"],
      moderationReasonCodes: ["suspicious.dep_not_found_on_registry"],
      moderationEvidence: [
        {
          code: "suspicious.dep_not_found_on_registry",
          severity: "critical",
          file: "Dependency manifests",
          line: 1,
          message: "missing dependency",
          evidence: "legacy dependency registry evidence",
        },
      ],
      moderationSummary: "Detected: suspicious.dep_not_found_on_registry",
      isSuspicious: true,
    };
    const get = vi.fn(async (id: string) => (id === skill._id ? skill : null));
    const patch = vi.fn(async (_id: string, _patch: Record<string, unknown>) => {});
    const deleteRow = vi.fn(async () => {});
    const { query } = makeSkillSearchDigestQuery(
      {
        _id: "skillSearchDigest:1",
        skillId: skill._id,
        moderationStatus: "hidden",
        moderationReason: "scanner.vt.suspicious",
        moderationFlags: ["flagged.suspicious"],
        isSuspicious: true,
      },
      {
        _id: "globalStats:default",
        key: "default",
        activeSkillsCount: 12,
        updatedAt: 100,
      },
    );

    const result = await applyDependencyRegistryScanCleanupInternalHandler(
      { db: { get, patch, delete: deleteRow, query } } as never,
      {
        versionIds: [],
        skillIds: [skill._id as never],
        cacheRowIds: [],
      },
    );

    expect(result).toEqual({
      versionRowsPatched: 0,
      staticScansRewritten: 0,
      skillRowsPatched: 1,
      cacheRowsDeleted: 0,
    });
    expect(patch).toHaveBeenCalledWith(
      skill._id,
      expect.objectContaining({
        moderationReason: "scanner.vt.suspicious",
        moderationStatus: "active",
        moderationVerdict: "suspicious",
        moderationFlags: ["flagged.suspicious"],
        moderationReasonCodes: undefined,
        moderationEvidence: undefined,
        moderationSummary: "Detected: scanner.vt.suspicious",
        isSuspicious: true,
        hiddenAt: undefined,
        hiddenBy: undefined,
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "skillSearchDigest:1",
      expect.objectContaining({
        skillId: skill._id,
        moderationStatus: "active",
        moderationReason: "scanner.vt.suspicious",
        moderationFlags: ["flagged.suspicious"],
        isSuspicious: true,
      }),
    );
    expect(deleteRow).not.toHaveBeenCalled();
  });

  it("preserves malware blocks when cleanup removes retired dependency registry moderation", async () => {
    const cases = [
      {
        id: "skills:malware-flag",
        moderationReason: "scanner.aggregate.suspicious",
        moderationVerdict: "suspicious",
        moderationFlags: ["blocked.malware"],
        expectedReason: "scanner.aggregate.malicious",
      },
      {
        id: "skills:malware-verdict",
        moderationReason: "scanner.vt.malicious",
        moderationVerdict: "malicious",
        moderationFlags: undefined,
        expectedReason: "scanner.vt.malicious",
      },
      {
        id: "skills:legacy-malware-reason",
        moderationReason: "scanner.vt.malicious",
        moderationVerdict: undefined,
        moderationFlags: undefined,
        expectedReason: "scanner.vt.malicious",
      },
    ];

    for (const item of cases) {
      const skill = {
        _id: item.id,
        slug: item.id.replace("skills:", ""),
        displayName: "Malware Block",
        ownerUserId: "users:owner",
        hiddenAt: 1_000,
        hiddenBy: "users:mod",
        stats: {
          downloads: 0,
          stars: 0,
          comments: 0,
          versions: 1,
          installsCurrent: 0,
          installsAllTime: 0,
        },
        moderationReason: item.moderationReason,
        moderationStatus: "hidden",
        moderationVerdict: item.moderationVerdict,
        moderationFlags: item.moderationFlags,
        moderationReasonCodes: ["suspicious.dep_not_found_on_registry"],
        moderationEvidence: [
          {
            code: "suspicious.dep_not_found_on_registry",
            severity: "critical",
            file: "Dependency manifests",
            line: 1,
            message: "missing dependency",
            evidence: "legacy dependency registry evidence",
          },
        ],
        moderationSummary: "Detected: suspicious.dep_not_found_on_registry",
        isSuspicious: true,
      };
      const get = vi.fn(async (id: string) => (id === skill._id ? skill : null));
      const patch = vi.fn(async (_id: string, _patch: Record<string, unknown>) => {});
      const deleteRow = vi.fn(async () => {});
      const { query } = makeSkillSearchDigestQuery({
        _id: "skillSearchDigest:1",
        skillId: skill._id,
        moderationStatus: "hidden",
        moderationReason: item.moderationReason,
        moderationFlags: item.moderationFlags,
        isSuspicious: true,
      });

      const result = await applyDependencyRegistryScanCleanupInternalHandler(
        { db: { get, patch, delete: deleteRow, query } } as never,
        {
          versionIds: [],
          skillIds: [skill._id as never],
          cacheRowIds: [],
        },
      );

      expect(result).toEqual({
        versionRowsPatched: 0,
        staticScansRewritten: 0,
        skillRowsPatched: 1,
        cacheRowsDeleted: 0,
      });
      expect(patch).toHaveBeenCalledWith(
        skill._id,
        expect.objectContaining({
          moderationReason: item.expectedReason,
          moderationStatus: "hidden",
          moderationVerdict: "malicious",
          moderationFlags: ["blocked.malware"],
          moderationReasonCodes: undefined,
          moderationEvidence: undefined,
          moderationSummary: "Detected: malicious scanner verdict",
          isSuspicious: false,
          hiddenAt: 1_000,
          hiddenBy: undefined,
        }),
      );
      expect(patch).toHaveBeenCalledWith(
        "skillSearchDigest:1",
        expect.objectContaining({
          skillId: skill._id,
          moderationStatus: "hidden",
          moderationReason: item.expectedReason,
          moderationFlags: ["blocked.malware"],
          isSuspicious: false,
        }),
      );
      expect(deleteRow).not.toHaveBeenCalled();
    }
  });

  it("preserves removed skill status when cleanup removes retired scanner-only moderation", async () => {
    const skill = {
      _id: "skills:removed",
      slug: "removed",
      displayName: "Removed",
      ownerUserId: "users:owner",
      softDeletedAt: 1_000,
      hiddenAt: 1_000,
      hiddenBy: "users:mod",
      stats: {
        downloads: 0,
        stars: 0,
        comments: 0,
        versions: 1,
        installsCurrent: 0,
        installsAllTime: 0,
      },
      moderationReason: "scanner.aggregate.suspicious",
      moderationStatus: "removed",
      moderationVerdict: "suspicious",
      moderationFlags: ["flagged.suspicious"],
      moderationReasonCodes: ["suspicious.dep_not_found_on_registry"],
      moderationEvidence: [
        {
          code: "suspicious.dep_not_found_on_registry",
          severity: "critical",
          file: "Dependency manifests",
          line: 1,
          message: "missing dependency",
          evidence: "legacy dependency registry evidence",
        },
      ],
      moderationSummary: "Detected: suspicious.dep_not_found_on_registry",
      isSuspicious: true,
    };
    const get = vi.fn(async (id: string) => (id === skill._id ? skill : null));
    const patch = vi.fn(async (_id: string, _patch: Record<string, unknown>) => {});
    const deleteRow = vi.fn(async () => {});
    const { query } = makeSkillSearchDigestQuery({
      _id: "skillSearchDigest:1",
      skillId: "skills:removed",
      softDeletedAt: 1_000,
      moderationStatus: "removed",
      moderationReason: "scanner.aggregate.suspicious",
      moderationFlags: ["flagged.suspicious"],
      isSuspicious: true,
    });

    const result = await applyDependencyRegistryScanCleanupInternalHandler(
      { db: { get, patch, delete: deleteRow, query } } as never,
      {
        versionIds: [],
        skillIds: ["skills:removed" as never],
        cacheRowIds: [],
      },
    );

    expect(result).toEqual({
      versionRowsPatched: 0,
      staticScansRewritten: 0,
      skillRowsPatched: 1,
      cacheRowsDeleted: 0,
    });
    const skillPatch = patch.mock.calls.find(([id]) => id === "skills:removed")?.[1];
    expect(skillPatch).toEqual({
      moderationReasonCodes: undefined,
      moderationEvidence: undefined,
    });
    expect(deleteRow).not.toHaveBeenCalled();
  });

  it("preserves hidden moderation when cleanup sees no moderation reason", async () => {
    const skill = {
      _id: "skills:hidden-no-reason",
      slug: "hidden-no-reason",
      displayName: "Hidden No Reason",
      ownerUserId: "users:owner",
      hiddenAt: 1_000,
      hiddenBy: "users:mod",
      stats: {
        downloads: 0,
        stars: 0,
        comments: 0,
        versions: 1,
        installsCurrent: 0,
        installsAllTime: 0,
      },
      moderationReason: undefined,
      moderationStatus: "hidden",
      moderationVerdict: "suspicious",
      moderationFlags: ["flagged.suspicious"],
      moderationReasonCodes: ["suspicious.dep_not_found_on_registry"],
      moderationEvidence: [
        {
          code: "suspicious.dep_not_found_on_registry",
          severity: "critical",
          file: "Dependency manifests",
          line: 1,
          message: "missing dependency",
          evidence: "legacy dependency registry evidence",
        },
      ],
      moderationSummary: "Detected: suspicious.dep_not_found_on_registry",
      isSuspicious: true,
    };
    const get = vi.fn(async (id: string) => (id === skill._id ? skill : null));
    const patch = vi.fn(async (_id: string, _patch: Record<string, unknown>) => {});
    const deleteRow = vi.fn(async () => {});
    const { query } = makeSkillSearchDigestQuery(
      {
        _id: "skillSearchDigest:1",
        skillId: "skills:hidden-no-reason",
        moderationStatus: "hidden",
        moderationReason: undefined,
        moderationFlags: ["flagged.suspicious"],
        isSuspicious: true,
      },
      {
        _id: "globalStats:default",
        key: "default",
        activeSkillsCount: 12,
        updatedAt: 100,
      },
    );

    const result = await applyDependencyRegistryScanCleanupInternalHandler(
      { db: { get, patch, delete: deleteRow, query } } as never,
      {
        versionIds: [],
        skillIds: ["skills:hidden-no-reason" as never],
        cacheRowIds: [],
      },
    );

    expect(result).toEqual({
      versionRowsPatched: 0,
      staticScansRewritten: 0,
      skillRowsPatched: 1,
      cacheRowsDeleted: 0,
    });
    const skillPatch = patch.mock.calls.find(([id]) => id === "skills:hidden-no-reason")?.[1];
    expect(skillPatch).toEqual({
      moderationReasonCodes: undefined,
      moderationEvidence: undefined,
    });
    expect(patch).toHaveBeenCalledWith(
      "skillSearchDigest:1",
      expect.objectContaining({
        skillId: "skills:hidden-no-reason",
        moderationStatus: "hidden",
        moderationReason: undefined,
        moderationFlags: ["flagged.suspicious"],
        isSuspicious: true,
      }),
    );
    expect(patch).not.toHaveBeenCalledWith("globalStats:default", expect.anything());
    expect(deleteRow).not.toHaveBeenCalled();
  });

  it("preserves manual moderation clears when cleanup removes retired reason codes", async () => {
    const skill = {
      _id: "skills:manual-clear",
      slug: "manual-clear",
      displayName: "Manual Clear",
      stats: {
        downloads: 0,
        stars: 0,
        comments: 0,
        versions: 1,
        installsCurrent: 0,
        installsAllTime: 0,
      },
      moderationReason: "manual.override.clean",
      moderationStatus: "active",
      moderationVerdict: "clean",
      moderationFlags: undefined,
      moderationReasonCodes: [
        "suspicious.dep_not_found_on_registry",
        "suspicious.dynamic_code_execution",
      ],
      moderationEvidence: [
        {
          code: "suspicious.dep_not_found_on_registry",
          severity: "critical",
          file: "Dependency manifests",
          line: 1,
          message: "missing dependency",
          evidence: "legacy dependency registry evidence",
        },
        {
          code: "suspicious.dynamic_code_execution",
          severity: "warn",
          file: "SKILL.md",
          line: 5,
          message: "dynamic code execution",
          evidence: "eval(payload)",
        },
      ],
      moderationSummary: "Manual override (clean): reviewed by moderators",
      isSuspicious: false,
    };
    const get = vi.fn(async (id: string) => (id === skill._id ? skill : null));
    const patch = vi.fn(async () => {});
    const deleteRow = vi.fn(async () => {});
    const { query } = makeSkillSearchDigestQuery({
      _id: "skillSearchDigest:1",
      skillId: "skills:manual-clear",
      moderationStatus: "active",
      moderationReason: "manual.override.clean",
      moderationFlags: undefined,
      isSuspicious: false,
    });

    const result = await applyDependencyRegistryScanCleanupInternalHandler(
      { db: { get, patch, delete: deleteRow, query } } as never,
      {
        versionIds: [],
        skillIds: ["skills:manual-clear" as never],
        cacheRowIds: [],
      },
    );

    expect(result).toEqual({
      versionRowsPatched: 0,
      staticScansRewritten: 0,
      skillRowsPatched: 1,
      cacheRowsDeleted: 0,
    });
    expect(patch).toHaveBeenCalledWith("skills:manual-clear", {
      moderationReasonCodes: ["suspicious.dynamic_code_execution"],
      moderationEvidence: [
        {
          code: "suspicious.dynamic_code_execution",
          severity: "warn",
          file: "SKILL.md",
          line: 5,
          message: "dynamic code execution",
          evidence: "eval(payload)",
        },
      ],
    });
    expect(deleteRow).not.toHaveBeenCalled();
  });
});

type QueryEq = {
  eq: (field: string, value: unknown) => QueryEq;
};

function makeLegacyPublisherOwnershipDb() {
  const now = 1_717_456_000_000;
  let nextPublisherId = 2;
  let nextMemberId = 1;
  const users = new Map<string, Record<string, unknown>>([
    [
      "users:legacy",
      {
        _id: "users:legacy",
        _creationTime: now - 1000,
        handle: "legacy-owner",
        name: "Legacy Owner",
        displayName: "Legacy Owner",
        deletedAt: undefined,
        deactivatedAt: undefined,
        purgedAt: undefined,
      },
    ],
    [
      "users:deleted",
      {
        _id: "users:deleted",
        _creationTime: now - 1000,
        handle: "deleted-owner",
        deletedAt: now - 10,
        deactivatedAt: undefined,
        purgedAt: undefined,
      },
    ],
  ]);
  const publishers = new Map<string, Record<string, unknown>>([
    [
      "publishers:existing",
      {
        _id: "publishers:existing",
        _creationTime: now - 500,
        kind: "user",
        handle: "existing-owner",
        displayName: "Existing Owner",
        linkedUserId: "users:existing",
        publishedSkills: 0,
        publishedPackages: 0,
        totalInstalls: 0,
        totalDownloads: 0,
        totalStars: 0,
        skillTotalInstalls: 0,
        skillTotalDownloads: 0,
        skillTotalStars: 0,
        createdAt: now - 500,
        updatedAt: now - 500,
      },
    ],
  ]);
  const publisherMembers = new Map<string, Record<string, unknown>>();
  const skills = new Map<string, Record<string, unknown>>([
    [
      "skills:legacy",
      {
        _id: "skills:legacy",
        _creationTime: now - 400,
        slug: "legacy-skill",
        displayName: "Legacy Skill",
        ownerUserId: "users:legacy",
        ownerPublisherId: undefined,
        latestVersionId: "skillVersions:legacy",
        tags: { latest: "skillVersions:legacy" },
        stats: {
          downloads: 10,
          stars: 3,
          installsCurrent: 2,
          installsAllTime: 5,
          comments: 0,
          versions: 1,
        },
        statsDownloads: 10,
        statsStars: 3,
        statsInstallsCurrent: 2,
        statsInstallsAllTime: 5,
        softDeletedAt: undefined,
        moderationStatus: "active",
        createdAt: now - 300,
        updatedAt: now - 200,
      },
    ],
    [
      "skills:deleted-owner",
      {
        _id: "skills:deleted-owner",
        _creationTime: now - 400,
        slug: "deleted-owner-skill",
        displayName: "Deleted Owner Skill",
        ownerUserId: "users:deleted",
        ownerPublisherId: undefined,
        latestVersionId: "skillVersions:deleted-owner",
        tags: { latest: "skillVersions:deleted-owner" },
        stats: {
          downloads: 1,
          stars: 0,
          installsCurrent: 0,
          installsAllTime: 0,
          comments: 0,
          versions: 1,
        },
        softDeletedAt: undefined,
        moderationStatus: "active",
        createdAt: now - 300,
        updatedAt: now - 200,
      },
    ],
  ]);
  const skillVersions = new Map<string, Record<string, unknown>>([
    [
      "skillVersions:legacy",
      {
        _id: "skillVersions:legacy",
        skillId: "skills:legacy",
        version: "1.0.0",
        softDeletedAt: undefined,
      },
    ],
    [
      "skillVersions:deleted-owner",
      {
        _id: "skillVersions:deleted-owner",
        skillId: "skills:deleted-owner",
        version: "1.0.0",
        softDeletedAt: undefined,
      },
    ],
  ]);
  const skillSlugAliases = new Map<string, Record<string, unknown>>([
    [
      "skillSlugAliases:legacy",
      {
        _id: "skillSlugAliases:legacy",
        slug: "old-legacy-skill",
        skillId: "skills:legacy",
        ownerUserId: "users:legacy",
        ownerPublisherId: undefined,
        createdAt: now - 250,
        updatedAt: now - 250,
      },
    ],
  ]);
  const skillEmbeddings = new Map<string, Record<string, unknown>>([
    [
      "skillEmbeddings:legacy",
      {
        _id: "skillEmbeddings:legacy",
        skillId: "skills:legacy",
        versionId: "skillVersions:legacy",
        ownerId: "users:legacy",
        ownerPublisherId: undefined,
        embedding: [0.1, 0.2],
        isLatest: true,
        isApproved: true,
        visibility: "public",
        updatedAt: now - 200,
      },
    ],
  ]);
  const skillSearchDigest = new Map<string, Record<string, unknown>>([
    [
      "skillSearchDigest:legacy",
      {
        _id: "skillSearchDigest:legacy",
        skillId: "skills:legacy",
        slug: "legacy-skill",
        displayName: "Legacy Skill",
        ownerUserId: "users:legacy",
        ownerPublisherId: undefined,
        ownerHandle: "legacy-owner",
        ownerKind: "user",
        stats: {
          downloads: 10,
          stars: 3,
          installsCurrent: 2,
          installsAllTime: 5,
          comments: 0,
          versions: 1,
        },
        statsDownloads: 10,
        statsStars: 3,
        statsInstallsCurrent: 2,
        statsInstallsAllTime: 5,
        softDeletedAt: undefined,
        moderationStatus: "active",
        createdAt: now - 300,
        updatedAt: now - 200,
      },
    ],
  ]);
  const packages = new Map<string, Record<string, unknown>>([
    [
      "packages:legacy",
      {
        _id: "packages:legacy",
        _creationTime: now - 400,
        name: "@legacy-owner/demo-plugin",
        normalizedName: "@legacy-owner/demo-plugin",
        displayName: "Demo Plugin",
        family: "bundle-plugin",
        channel: "community",
        isOfficial: false,
        ownerUserId: "users:legacy",
        ownerPublisherId: undefined,
        summary: "Demo package",
        latestReleaseId: undefined,
        tags: {},
        compatibility: undefined,
        capabilities: undefined,
        verification: undefined,
        scanStatus: "clean",
        stats: { downloads: 7, installs: 4, stars: 2, versions: 1 },
        softDeletedAt: undefined,
        createdAt: now - 300,
        updatedAt: now - 200,
      },
    ],
  ]);
  const packageSearchDigest = new Map<string, Record<string, unknown>>([
    [
      "packageSearchDigest:legacy",
      {
        _id: "packageSearchDigest:legacy",
        packageId: "packages:legacy",
        name: "@legacy-owner/demo-plugin",
        normalizedName: "@legacy-owner/demo-plugin",
        displayName: "Demo Plugin",
        family: "bundle-plugin",
        channel: "community",
        isOfficial: false,
        ownerUserId: "users:legacy",
        ownerPublisherId: undefined,
        ownerHandle: "legacy-owner",
        ownerKind: "user",
        summary: "Demo package",
        scanStatus: "clean",
        softDeletedAt: undefined,
        createdAt: now - 300,
        updatedAt: now - 200,
      },
    ],
  ]);
  const packageCapabilitySearchDigest = new Map<string, Record<string, unknown>>();
  const packagePluginCategorySearchDigest = new Map<string, Record<string, unknown>>();

  const tableMap: Record<string, Map<string, Record<string, unknown>>> = {
    users,
    publishers,
    publisherMembers,
    skills,
    skillVersions,
    skillSlugAliases,
    skillEmbeddings,
    skillSearchDigest,
    packages,
    packageSearchDigest,
    packageCapabilitySearchDigest,
    packagePluginCategorySearchDigest,
  };
  const patchCalls: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const insertCalls: Array<{ table: string; value: Record<string, unknown> }> = [];

  const getRows = (table: string) => Array.from(tableMap[table]?.values() ?? []);
  const getTableForId = (id: string) => id.split(":")[0];
  const readField = (row: Record<string, unknown>, field: string) =>
    field.split(".").reduce<unknown>((value, part) => {
      if (!value || typeof value !== "object") return undefined;
      return (value as Record<string, unknown>)[part];
    }, row);
  const makeQuery = (table: string, rows: Record<string, unknown>[]) => ({
    collect: vi.fn(async () => rows),
    unique: vi.fn(async () => rows[0] ?? null),
    take: vi.fn(async (limit: number) => rows.slice(0, limit)),
    order: vi.fn(() => ({
      take: vi.fn(async (limit: number) => rows.slice(0, limit)),
      paginate: vi.fn(async ({ cursor, numItems }: { cursor: string | null; numItems: number }) =>
        paginateRows(rows, cursor, numItems),
      ),
    })),
    paginate: vi.fn(async ({ cursor, numItems }: { cursor: string | null; numItems: number }) =>
      paginateRows(rows, cursor, numItems),
    ),
    withIndex: vi.fn((indexName: string, build?: (q: QueryEq) => unknown) => {
      const filters: Array<{ field: string; value: unknown }> = [];
      const q: QueryEq = {
        eq: (field, value) => {
          filters.push({ field, value });
          return q;
        },
      };
      build?.(q);
      let indexedRows = getRows(table).filter((row) =>
        filters.every((filter) => readField(row, filter.field) === filter.value),
      );
      if (table === "users" && indexName === "by_active_handle") {
        indexedRows = indexedRows.filter(
          (row) => row.deletedAt === undefined && row.deactivatedAt === undefined,
        );
      }
      return makeQuery(table, indexedRows);
    }),
  });

  const db = {
    get: vi.fn(async (id: string) => tableMap[getTableForId(id)]?.get(id) ?? null),
    query: vi.fn((table: string) => makeQuery(table, getRows(table))),
    patch: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      patchCalls.push({ id, patch });
      const row = tableMap[getTableForId(id)]?.get(id);
      if (row) Object.assign(row, patch);
    }),
    insert: vi.fn(async (table: string, value: Record<string, unknown>) => {
      const id =
        table === "publishers"
          ? `publishers:created${nextPublisherId++}`
          : table === "publisherMembers"
            ? `publisherMembers:created${nextMemberId++}`
            : `${table}:created`;
      insertCalls.push({ table, value });
      tableMap[table].set(id, { _id: id, _creationTime: now, ...value });
      return id;
    }),
    delete: vi.fn(async (id: string) => {
      tableMap[getTableForId(id)]?.delete(id);
    }),
    normalizeId: vi.fn(),
  };

  return {
    db,
    patchCalls,
    insertCalls,
    tableMap,
  };
}

function paginateRows(rows: Record<string, unknown>[], cursor: string | null, numItems: number) {
  const start = cursor ? Number(cursor) : 0;
  const page = rows.slice(start, start + numItems);
  const next = start + page.length;
  return {
    page,
    continueCursor: next >= rows.length ? null : String(next),
    isDone: next >= rows.length,
  };
}

describe("maintenance legacy publisher ownership repair", () => {
  it("dry-runs legacy publisher ownership repair without writes", async () => {
    const { db, patchCalls, insertCalls } = makeLegacyPublisherOwnershipDb();

    const result = await repairLegacyPublisherOwnershipHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      { phase: "users", dryRun: true, batchSize: 10, scheduleNext: false },
    );

    expect(result).toMatchObject({
      phase: "users",
      dryRun: true,
      scanned: 1,
      repaired: 1,
      skipped: 0,
      isDone: true,
    });
    expect(patchCalls).toEqual([]);
    expect(insertCalls).toEqual([]);
  });

  it("reports dry-run personal publisher handle conflicts without writes", async () => {
    const { db, tableMap, patchCalls, insertCalls } = makeLegacyPublisherOwnershipDb();
    tableMap.users.set("users:conflict", {
      _id: "users:conflict",
      _creationTime: 1_717_456_000_000 - 1000,
      handle: "existing-owner",
      name: "Conflicting Owner",
      displayName: "Conflicting Owner",
      deletedAt: undefined,
      deactivatedAt: undefined,
      purgedAt: undefined,
    });

    const result = await repairLegacyPublisherOwnershipHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      { phase: "users", dryRun: true, batchSize: 10, scheduleNext: false },
    );

    expect(result).toMatchObject({
      phase: "users",
      dryRun: true,
      scanned: 2,
      repaired: 1,
      skipped: 1,
      isDone: true,
      errors: ['user:users:conflict: Publisher handle "@existing-owner" is already claimed'],
    });
    expect(patchCalls).toEqual([]);
    expect(insertCalls).toEqual([]);
  });

  it("skips apply-mode personal publisher handle conflicts while repairing other users", async () => {
    const { db, tableMap } = makeLegacyPublisherOwnershipDb();
    tableMap.users.set("users:conflict", {
      _id: "users:conflict",
      _creationTime: 1_717_456_000_000 - 1000,
      handle: "existing-owner",
      name: "Conflicting Owner",
      displayName: "Conflicting Owner",
      deletedAt: undefined,
      deactivatedAt: undefined,
      purgedAt: undefined,
    });

    const result = await repairLegacyPublisherOwnershipHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      { phase: "users", dryRun: false, batchSize: 10, scheduleNext: false },
    );

    const createdPublisher = Array.from(tableMap.publishers.values()).find(
      (publisher) => publisher.handle === "legacy-owner",
    );
    expect(result).toMatchObject({
      phase: "users",
      dryRun: false,
      scanned: 2,
      repaired: 1,
      skipped: 1,
      isDone: true,
      errors: ['user:users:conflict: Publisher handle "@existing-owner" is already claimed'],
    });
    expect(createdPublisher).toMatchObject({
      kind: "user",
      linkedUserId: "users:legacy",
    });
    expect(tableMap.users.get("users:legacy")).toMatchObject({
      personalPublisherId: createdPublisher?._id,
    });
    expect(tableMap.users.get("users:conflict")).not.toHaveProperty("personalPublisherId");
  });

  it("repairs active legacy users, skills, aliases, embeddings, and packages", async () => {
    const { db, tableMap, patchCalls, insertCalls } = makeLegacyPublisherOwnershipDb();
    const scheduler = { runAfter: vi.fn() };

    const usersResult = await repairLegacyPublisherOwnershipHandler({ db, scheduler } as never, {
      phase: "users",
      dryRun: false,
      batchSize: 10,
      scheduleNext: false,
    });
    const createdPublisher = Array.from(tableMap.publishers.values()).find(
      (publisher) => publisher.handle === "legacy-owner",
    );
    expect(usersResult).toMatchObject({
      phase: "users",
      dryRun: false,
      scanned: 1,
      repaired: 1,
      skipped: 0,
      isDone: true,
    });
    expect(createdPublisher).toMatchObject({
      kind: "user",
      handle: "legacy-owner",
      displayName: "Legacy Owner",
      linkedUserId: "users:legacy",
    });
    expect(tableMap.users.get("users:legacy")).toMatchObject({
      personalPublisherId: createdPublisher?._id,
    });
    expect(insertCalls.some((call) => call.table === "publisherMembers")).toBe(true);

    const skillsResult = await repairLegacyPublisherOwnershipHandler({ db, scheduler } as never, {
      phase: "skills",
      dryRun: false,
      batchSize: 10,
      scheduleNext: false,
    });
    expect(skillsResult).toMatchObject({
      phase: "skills",
      dryRun: false,
      scanned: 2,
      repaired: 1,
      skipped: 1,
      isDone: true,
    });
    expect(tableMap.skills.get("skills:legacy")).toMatchObject({
      ownerPublisherId: createdPublisher?._id,
    });
    expect(tableMap.skills.get("skills:deleted-owner")).toMatchObject({
      ownerPublisherId: undefined,
    });
    expect(tableMap.skillSlugAliases.get("skillSlugAliases:legacy")).toMatchObject({
      ownerPublisherId: createdPublisher?._id,
    });
    expect(tableMap.skillEmbeddings.get("skillEmbeddings:legacy")).not.toHaveProperty(
      "ownerPublisherId",
      createdPublisher?._id,
    );

    const packagesResult = await repairLegacyPublisherOwnershipHandler({ db, scheduler } as never, {
      phase: "packages",
      dryRun: false,
      batchSize: 10,
      scheduleNext: false,
    });
    expect(packagesResult).toMatchObject({
      phase: "packages",
      dryRun: false,
      scanned: 1,
      repaired: 1,
      skipped: 0,
      isDone: true,
    });
    expect(tableMap.packages.get("packages:legacy")).toMatchObject({
      ownerPublisherId: createdPublisher?._id,
    });
    expect(patchCalls.some((call) => call.id === "skillSearchDigest:legacy")).toBe(false);
    expect(patchCalls.some((call) => call.id === "packageSearchDigest:legacy")).toBe(false);
    expect(
      patchCalls.some(
        (call) =>
          call.id === createdPublisher?._id &&
          ("publishedSkills" in call.patch || "publishedPackages" in call.patch),
      ),
    ).toBe(false);
  });

  it("repairs legacy owner projections for one targeted user by handle", async () => {
    const { db, tableMap } = makeLegacyPublisherOwnershipDb();
    const scheduler = { runAfter: vi.fn() };

    await repairLegacyPublisherOwnershipHandler({ db, scheduler } as never, {
      phase: "users",
      dryRun: false,
      batchSize: 10,
      scheduleNext: false,
    });
    const createdPublisher = Array.from(tableMap.publishers.values()).find(
      (publisher) => publisher.handle === "legacy-owner",
    );

    const skillsResult = await repairLegacyPublisherOwnershipForUserHandler(
      { db, scheduler } as never,
      {
        handle: "legacy-owner",
        phase: "skills",
        dryRun: false,
        batchSize: 10,
        scheduleNext: false,
      },
    );
    expect(skillsResult).toMatchObject({
      phase: "skills",
      dryRun: false,
      userId: "users:legacy",
      publisherId: createdPublisher?._id,
      scanned: 1,
      repaired: 1,
      skipped: 0,
      isDone: true,
    });
    expect(tableMap.skills.get("skills:legacy")).toMatchObject({
      ownerPublisherId: createdPublisher?._id,
    });
    expect(tableMap.skills.get("skills:deleted-owner")).toMatchObject({
      ownerPublisherId: undefined,
    });
    expect(tableMap.skillSlugAliases.get("skillSlugAliases:legacy")).toMatchObject({
      ownerPublisherId: createdPublisher?._id,
    });
    expect(tableMap.skillEmbeddings.get("skillEmbeddings:legacy")).not.toHaveProperty(
      "ownerPublisherId",
      createdPublisher?._id,
    );

    const packagesResult = await repairLegacyPublisherOwnershipForUserHandler(
      { db, scheduler } as never,
      {
        handle: "legacy-owner",
        phase: "packages",
        dryRun: false,
        batchSize: 10,
        scheduleNext: false,
      },
    );
    expect(packagesResult).toMatchObject({
      phase: "packages",
      dryRun: false,
      userId: "users:legacy",
      publisherId: createdPublisher?._id,
      scanned: 1,
      repaired: 1,
      skipped: 0,
      isDone: true,
    });
    expect(tableMap.packages.get("packages:legacy")).toMatchObject({
      ownerPublisherId: createdPublisher?._id,
    });
  });

  it("does not touch skill embeddings during apply-mode skill repair", async () => {
    const { db } = makeLegacyPublisherOwnershipDb();
    const scheduler = { runAfter: vi.fn() };

    await repairLegacyPublisherOwnershipHandler({ db, scheduler } as never, {
      phase: "users",
      dryRun: false,
      batchSize: 10,
      scheduleNext: false,
    });

    const patch = db.patch;
    db.patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
      if (id === "skillEmbeddings:legacy") throw new Error("embedding sync failed");
      await patch(id, value);
    });

    await expect(
      repairLegacyPublisherOwnershipHandler({ db, scheduler } as never, {
        phase: "skills",
        dryRun: false,
        batchSize: 10,
        scheduleNext: false,
      }),
    ).resolves.toMatchObject({
      phase: "skills",
      repaired: 1,
    });
  });

  it("propagates apply-mode package patch failures", async () => {
    const { db } = makeLegacyPublisherOwnershipDb();
    const scheduler = { runAfter: vi.fn() };

    await repairLegacyPublisherOwnershipHandler({ db, scheduler } as never, {
      phase: "users",
      dryRun: false,
      batchSize: 10,
      scheduleNext: false,
    });

    const patch = db.patch;
    db.patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
      if (id === "packages:legacy") throw new Error("package patch failed");
      await patch(id, value);
    });

    await expect(
      repairLegacyPublisherOwnershipHandler({ db, scheduler } as never, {
        phase: "packages",
        dryRun: false,
        batchSize: 10,
        scheduleNext: false,
      }),
    ).rejects.toThrow("package patch failed");
  });
});

describe("maintenance backfill", () => {
  it("patches stale skill search digest rank stats from legacy skill stats", async () => {
    const existingDigest = {
      _id: "skillSearchDigest:1",
      skillId: "skills:1",
      slug: "demo",
      displayName: "Demo",
      summary: "Old summary",
      ownerUserId: "users:owner",
      tags: {},
      stats: {
        downloads: 3,
        stars: 2,
        installsCurrent: 4,
        installsAllTime: 5,
        versions: 1,
        comments: 0,
      },
      softDeletedAt: undefined,
      createdAt: 100,
      updatedAt: 200,
    };
    const skill = {
      _id: "skills:1",
      slug: "demo",
      displayName: "Demo",
      summary: "New summary",
      ownerUserId: "users:owner",
      tags: {},
      stats: {
        downloads: 42,
        stars: 7,
        installsCurrent: 9,
        installsAllTime: 100,
        versions: 1,
        comments: 0,
      },
      softDeletedAt: undefined,
      createdAt: 100,
      updatedAt: 300,
    };
    const paginate = vi.fn().mockResolvedValue({
      page: [skill],
      continueCursor: null,
      isDone: true,
    });
    const unique = vi.fn().mockResolvedValue(existingDigest);
    class TestEqBuilder {
      eq(_field: string, _value: unknown) {
        return this;
      }
    }
    const withIndex = vi.fn((_indexName: string, build: (q: TestEqBuilder) => unknown) => {
      build(new TestEqBuilder());
      return { unique };
    });
    const query = vi.fn((table: string) => {
      if (table === "skills") return { paginate };
      if (table === "skillSearchDigest") return { withIndex };
      throw new Error(`unexpected table ${table}`);
    });
    const patch = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn().mockResolvedValue("skillSearchDigest:inserted");
    const replace = vi.fn().mockResolvedValue(undefined);
    const deleteDoc = vi.fn().mockResolvedValue(undefined);

    const result = await (
      backfillSkillSearchDigestInternal as unknown as { _handler: Function }
    )._handler(
      {
        db: {
          get: vi.fn(),
          query,
          patch,
          insert,
          replace,
          delete: deleteDoc,
          normalizeId: vi.fn(),
        },
        scheduler: {
          runAfter: vi.fn(),
        },
      } as never,
      { batchSize: 10 },
    );

    expect(result).toEqual({ upserted: 1, isDone: true, scanned: 1 });
    expect(paginate).toHaveBeenCalledWith({ cursor: null, numItems: 10 });
    expect(withIndex).toHaveBeenCalledWith("by_skill", expect.any(Function));
    expect(insert).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      "skillSearchDigest:1",
      expect.objectContaining({
        summary: "New summary",
        statsDownloads: 42,
        statsStars: 7,
        statsInstallsCurrent: 9,
        statsInstallsAllTime: 100,
        stats: expect.objectContaining({
          downloads: 42,
          stars: 7,
          installsCurrent: 9,
          installsAllTime: 100,
        }),
      }),
    );
  });

  it("repairs summary + parsed by reparsing SKILL.md", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          kind: "ok",
          skillId: "skills:1",
          skillSlug: "skill-1",
          skillDisplayName: "Skill 1",
          versionId: "skillVersions:1",
          skillSummary: ">",
          versionParsed: { frontmatter: { description: ">" } },
          readmeStorageId: "storage:1",
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn().mockResolvedValue({ ok: true });
    const storageGet = vi
      .fn()
      .mockResolvedValue(makeBlob(`---\ndescription: >\n  Hello\n  world.\n---\nBody`));

    const result = await backfillSkillSummariesInternalHandler(
      { runQuery, runMutation, storage: { get: storageGet } } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1 },
    );

    expect(result.ok).toBe(true);
    expect(result.stats.skillsScanned).toBe(1);
    expect(result.stats.skillsPatched).toBe(1);
    expect(result.stats.versionsPatched).toBe(1);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      skillId: "skills:1",
      versionId: "skillVersions:1",
      summary: "Hello world.",
      parsed: {
        frontmatter: { description: "Hello world." },
        metadata: undefined,
        clawdis: undefined,
        license: "MIT-0",
      },
    });
  });

  it("dryRun does not patch", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          kind: "ok",
          skillId: "skills:1",
          skillSlug: "skill-1",
          skillDisplayName: "Skill 1",
          versionId: "skillVersions:1",
          skillSummary: ">",
          versionParsed: { frontmatter: { description: ">" } },
          readmeStorageId: "storage:1",
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn();
    const storageGet = vi.fn().mockResolvedValue(makeBlob(`---\ndescription: Hello\n---\nBody`));

    const result = await backfillSkillSummariesInternalHandler(
      { runQuery, runMutation, storage: { get: storageGet } } as never,
      { dryRun: true, batchSize: 10, maxBatches: 1 },
    );

    expect(result.ok).toBe(true);
    expect(result.stats.skillsPatched).toBe(1);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("counts missing storage blob", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          kind: "ok",
          skillId: "skills:1",
          skillSlug: "skill-1",
          skillDisplayName: "Skill 1",
          versionId: "skillVersions:1",
          skillSummary: null,
          versionParsed: { frontmatter: {} },
          readmeStorageId: "storage:missing",
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn();
    const storageGet = vi.fn().mockResolvedValue(null);

    const result = await backfillSkillSummariesInternalHandler(
      { runQuery, runMutation, storage: { get: storageGet } } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1 },
    );

    expect(result.stats.missingStorageBlob).toBe(1);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("fills empty summary via AI when useAi is enabled", async () => {
    vi.mocked(generateSkillSummary).mockResolvedValue("AI generated summary.");

    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          kind: "ok",
          skillId: "skills:1",
          skillSlug: "ai-skill",
          skillDisplayName: "AI Skill",
          versionId: "skillVersions:1",
          skillSummary: null,
          versionParsed: { frontmatter: {} },
          readmeStorageId: "storage:1",
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn().mockResolvedValue({ ok: true });
    const storageGet = vi.fn().mockResolvedValue(makeBlob("# AI Skill\n\nUseful automation."));

    const result = await backfillSkillSummariesInternalHandler(
      { runQuery, runMutation, storage: { get: storageGet } } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1, useAi: true },
    );

    expect(result.ok).toBe(true);
    expect(result.stats.skillsPatched).toBe(1);
    expect(result.stats.aiSummariesPatched).toBe(1);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      skillId: "skills:1",
      versionId: "skillVersions:1",
      summary: "AI generated summary.",
      parsed: {
        frontmatter: {},
        metadata: undefined,
        clawdis: undefined,
        license: "MIT-0",
      },
    });
  });

  it("re-syncs latestVersionSummary when changelogSource or clawdis drift", async () => {
    const paginate = vi.fn().mockResolvedValue({
      page: [
        {
          _id: "skills:1",
          latestVersionId: "skillVersions:1",
          latestVersionSummary: {
            version: "1.0.0",
            createdAt: 123,
            changelog: "Same changelog",
            changelogSource: "user",
            clawdis: undefined,
          },
        },
      ],
      continueCursor: null,
      isDone: true,
    });
    const get = vi.fn().mockResolvedValue({
      _id: "skillVersions:1",
      version: "1.0.0",
      createdAt: 123,
      changelog: "Same changelog",
      changelogSource: "auto",
      parsed: { clawdis: { emoji: "lobster" } },
    });
    const patch = vi.fn().mockResolvedValue(undefined);
    const runAfter = vi.fn();

    const ctx = {
      db: {
        query: vi.fn(() => ({ paginate })),
        get,
        patch,
        normalizeId: vi.fn(),
      },
      scheduler: {
        runAfter,
      },
    } as never;

    const result = await (
      backfillLatestVersionSummaryInternal as unknown as { _handler: Function }
    )._handler(ctx, {
      batchSize: 10,
    });

    expect(result).toEqual({ patched: 1, isDone: true, scanned: 1 });
    expect(paginate).toHaveBeenCalledWith({ cursor: null, numItems: 10 });
    expect(patch).toHaveBeenCalledWith("skills:1", {
      latestVersionSummary: {
        version: "1.0.0",
        createdAt: 123,
        changelog: "Same changelog",
        changelogSource: "auto",
        clawdis: { emoji: "lobster" },
      },
    });
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("backfills digest capability tags even when version summary already matches", async () => {
    const digest = {
      _id: "skillSearchDigest:1",
      skillId: "skills:1",
      latestVersionId: "skillVersions:1",
      latestVersionSkillId: "skills:1",
      latestVersionSummary: {
        version: "1.0.0",
        createdAt: 123,
        changelog: "Same changelog",
        changelogSource: "user",
        clawdis: undefined,
      },
      capabilityTags: ["old"],
    };
    const skill = {
      _id: "skills:1",
      slug: "demo",
      displayName: "Demo",
      stats: {
        downloads: 0,
        stars: 0,
        installsCurrent: 0,
        installsAllTime: 0,
        versions: 1,
        comments: 0,
      },
      latestVersionId: "skillVersions:1",
      latestVersionSummary: digest.latestVersionSummary,
      capabilityTags: ["read-files"],
    };
    const version = {
      _id: "skillVersions:1",
      skillId: "skills:1",
      softDeletedAt: undefined,
      version: "1.0.0",
    };
    const paginate = vi.fn().mockResolvedValue({
      page: [digest],
      continueCursor: null,
      isDone: true,
    });
    const patch = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      db: {
        query: vi.fn(() => ({ paginate })),
        get: vi.fn(async (id: string) => {
          if (id === "skills:1") return skill;
          if (id === "skillVersions:1") return version;
          return null;
        }),
        patch,
        normalizeId: vi.fn(),
      },
      scheduler: {
        runAfter: vi.fn(),
      },
    } as never;

    const result = await (
      backfillDigestVersionSummary as unknown as { _handler: Function }
    )._handler(ctx, {
      batchSize: 10,
    });

    expect(result).toEqual({ patched: 1, isDone: true, scanned: 1 });
    expect(patch).toHaveBeenCalledWith("skillSearchDigest:1", {
      latestVersionId: "skillVersions:1",
      latestVersionSkillId: "skills:1",
      latestVersionSummary: digest.latestVersionSummary,
      capabilityTags: ["read-files"],
    });
  });

  it("backfills denormalized user hover stats from indexed owner pages", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        items: [{ _id: "users:1" }],
        cursor: null,
        isDone: true,
      })
      .mockResolvedValueOnce({
        items: [
          { stats: { stars: 4, downloads: 30 }, softDeletedAt: undefined },
          { stats: { stars: 2, downloads: 10 }, softDeletedAt: 123 },
          { stats: { stars: 1, downloads: 5 }, softDeletedAt: undefined },
        ],
        cursor: null,
        isDone: true,
      });
    const runMutation = vi.fn().mockResolvedValue({ ok: true });

    const result = await backfillUserStatsInternalHandler({ runQuery, runMutation } as never, {
      batchSize: 10,
      skillBatchSize: 50,
      maxBatches: 1,
    });

    expect(result).toEqual({
      ok: true,
      stats: {
        usersScanned: 1,
        usersPatched: 1,
      },
      isDone: true,
      cursor: null,
    });
    expect(runQuery).toHaveBeenNthCalledWith(
      1,
      internal.maintenance.getUserStatsBackfillPageInternal,
      {
        cursor: undefined,
        batchSize: 10,
      },
    );
    expect(runQuery).toHaveBeenNthCalledWith(
      2,
      internal.maintenance.getUserOwnedSkillsBackfillPageInternal,
      {
        ownerUserId: "users:1",
        cursor: undefined,
        batchSize: 50,
      },
    );
    expect(runMutation).toHaveBeenCalledWith(
      internal.maintenance.applyUserStatsBackfillPatchInternal,
      {
        userId: "users:1",
        publishedSkills: 2,
        totalStars: 5,
        totalDownloads: 35,
      },
    );
  });

  it("backfills denormalized publisher stats through the recompute mutation", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      items: [{ _id: "publishers:1" }, { _id: "publishers:2" }],
      cursor: "next",
      isDone: false,
    });
    const runMutation = vi.fn().mockResolvedValue({ ok: true });

    const result = await backfillPublisherStatsInternalHandler({ runQuery, runMutation } as never, {
      dryRun: true,
      batchSize: 2,
      maxBatches: 1,
    });

    expect(result).toEqual({
      ok: true,
      stats: {
        publishersScanned: 2,
        publishersPatched: 0,
      },
      isDone: false,
      cursor: "next",
    });
    expect(runQuery).toHaveBeenCalledWith(
      internal.maintenance.getPublisherStatsBackfillPageInternal,
      {
        cursor: undefined,
        batchSize: 2,
      },
    );
    expect(runMutation).toHaveBeenNthCalledWith(
      1,
      internal.maintenance.recomputePublisherStatsInternal,
      {
        publisherId: "publishers:1",
        dryRun: true,
      },
    );
    expect(runMutation).toHaveBeenNthCalledWith(
      2,
      internal.maintenance.recomputePublisherStatsInternal,
      {
        publisherId: "publishers:2",
        dryRun: true,
      },
    );
  });
});

describe("maintenance badge denormalization", () => {
  it("upserts table badge and keeps skill.badges in sync", async () => {
    const unique = vi.fn().mockResolvedValue(null);
    const query = vi.fn().mockReturnValue({
      withIndex: () => ({ unique }),
    });
    const insert = vi.fn().mockResolvedValue("skillBadges:1");
    const get = vi.fn().mockResolvedValue({ _id: "skills:1", badges: undefined });
    const patch = vi.fn().mockResolvedValue(undefined);

    const ctx = {
      db: {
        query,
        insert,
        get,
        patch,
        normalizeId: vi.fn(),
      },
    } as never;

    const result = await (
      upsertSkillBadgeRecordInternal as unknown as { _handler: Function }
    )._handler(ctx, {
      skillId: "skills:1",
      kind: "highlighted",
      byUserId: "users:1",
      at: 123,
    });

    expect(result).toEqual({ inserted: true });
    expect(insert).toHaveBeenCalledWith("skillBadges", {
      skillId: "skills:1",
      kind: "highlighted",
      byUserId: "users:1",
      at: 123,
    });
    expect(patch).toHaveBeenCalledWith("skills:1", {
      badges: {
        highlighted: { byUserId: "users:1", at: 123 },
      },
    });
  });

  it("resyncs denormalized badge even when table record already exists", async () => {
    const unique = vi.fn().mockResolvedValue({ _id: "skillBadges:existing" });
    const query = vi.fn().mockReturnValue({
      withIndex: () => ({ unique }),
    });
    const insert = vi.fn();
    const get = vi.fn().mockResolvedValue({ _id: "skills:1", badges: {} });
    const patch = vi.fn().mockResolvedValue(undefined);

    const ctx = {
      db: {
        query,
        insert,
        get,
        patch,
        normalizeId: vi.fn(),
      },
    } as never;

    const result = await (
      upsertSkillBadgeRecordInternal as unknown as { _handler: Function }
    )._handler(ctx, {
      skillId: "skills:1",
      kind: "official",
      byUserId: "users:2",
      at: 456,
    });

    expect(result).toEqual({ inserted: false });
    expect(insert).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith("skills:1", {
      badges: {
        official: { byUserId: "users:2", at: 456 },
      },
    });
  });
});

describe("maintenance capability tag backfill", () => {
  it("keeps latest skill search digest capability tags in sync", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1234);
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "skillVersions:1",
        capabilityTags: ["can-make-purchases"],
      })
      .mockResolvedValueOnce({
        _id: "skills:1",
        latestVersionId: "skillVersions:1",
        capabilityTags: ["can-make-purchases"],
      });
    const unique = vi.fn().mockResolvedValue({
      _id: "skillSearchDigest:1",
      capabilityTags: ["can-make-purchases"],
    });
    const withIndex = vi.fn((_indexName, callback) => {
      callback({ eq: vi.fn() });
      return { unique };
    });
    const query = vi.fn().mockReturnValue({ withIndex });
    const patch = vi.fn().mockResolvedValue(undefined);

    const result = await (
      applySkillCapabilityTagsInternal as unknown as { _handler: Function }
    )._handler(
      {
        db: {
          get,
          patch,
          query,
          normalizeId: vi.fn(),
        },
      } as never,
      {
        skillId: "skills:1",
        versionId: "skillVersions:1",
        capabilityTags: ["financial-authority", "can-make-purchases"],
      },
    );

    expect(result).toEqual({
      ok: true,
      versionPatched: true,
      skillPatched: true,
      digestPatched: true,
    });
    expect(patch).toHaveBeenNthCalledWith(1, "skillVersions:1", {
      capabilityTags: ["financial-authority", "can-make-purchases"],
    });
    expect(patch).toHaveBeenNthCalledWith(2, "skills:1", {
      capabilityTags: ["financial-authority", "can-make-purchases"],
      updatedAt: 1234,
    });
    expect(patch).toHaveBeenNthCalledWith(3, "skillSearchDigest:1", {
      capabilityTags: ["financial-authority", "can-make-purchases"],
      updatedAt: 1234,
    });
    expect(query).toHaveBeenCalledWith("skillSearchDigest");
    expect(withIndex).toHaveBeenCalledWith("by_skill", expect.any(Function));

    nowSpy.mockRestore();
  });

  it("counts trigger-synced digest tags when the latest skill tags change", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(2222);
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "skillVersions:1",
        capabilityTags: ["can-make-purchases"],
      })
      .mockResolvedValueOnce({
        _id: "skills:1",
        latestVersionId: "skillVersions:1",
        capabilityTags: ["can-make-purchases"],
      });
    const unique = vi.fn().mockResolvedValue({
      _id: "skillSearchDigest:1",
      capabilityTags: ["financial-authority", "can-make-purchases"],
    });
    const withIndex = vi.fn((_indexName, callback) => {
      callback({ eq: vi.fn() });
      return { unique };
    });
    const query = vi.fn().mockReturnValue({ withIndex });
    const patch = vi.fn().mockResolvedValue(undefined);

    const result = await (
      applySkillCapabilityTagsInternal as unknown as { _handler: Function }
    )._handler(
      {
        db: {
          get,
          patch,
          query,
          normalizeId: vi.fn(),
        },
      } as never,
      {
        skillId: "skills:1",
        versionId: "skillVersions:1",
        capabilityTags: ["financial-authority", "can-make-purchases"],
      },
    );

    expect(result).toEqual({
      ok: true,
      versionPatched: true,
      skillPatched: true,
      digestPatched: true,
    });
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch).toHaveBeenNthCalledWith(1, "skillVersions:1", {
      capabilityTags: ["financial-authority", "can-make-purchases"],
    });
    expect(patch).toHaveBeenNthCalledWith(2, "skills:1", {
      capabilityTags: ["financial-authority", "can-make-purchases"],
      updatedAt: 2222,
    });

    nowSpy.mockRestore();
  });

  it("repairs a stale latest skill search digest even when skill tags already match", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "skillVersions:1",
        capabilityTags: ["financial-authority", "can-make-purchases"],
      })
      .mockResolvedValueOnce({
        _id: "skills:1",
        latestVersionId: "skillVersions:1",
        capabilityTags: ["financial-authority", "can-make-purchases"],
        updatedAt: 987,
      });
    const unique = vi.fn().mockResolvedValue({
      _id: "skillSearchDigest:1",
      capabilityTags: ["can-make-purchases"],
    });
    const withIndex = vi.fn((_indexName, callback) => {
      callback({ eq: vi.fn() });
      return { unique };
    });
    const query = vi.fn().mockReturnValue({ withIndex });
    const patch = vi.fn().mockResolvedValue(undefined);

    const result = await (
      applySkillCapabilityTagsInternal as unknown as { _handler: Function }
    )._handler(
      {
        db: {
          get,
          patch,
          query,
          normalizeId: vi.fn(),
        },
      } as never,
      {
        skillId: "skills:1",
        versionId: "skillVersions:1",
        capabilityTags: ["financial-authority", "can-make-purchases"],
      },
    );

    expect(result).toEqual({
      ok: true,
      versionPatched: false,
      skillPatched: false,
      digestPatched: true,
    });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith("skillSearchDigest:1", {
      capabilityTags: ["financial-authority", "can-make-purchases"],
      updatedAt: 987,
    });
  });
});

describe("maintenance fingerprint backfill", () => {
  it("backfills fingerprint field and inserts index entry", async () => {
    const { hashSkillFiles } = await import("./lib/skills");
    const expected = await hashSkillFiles([{ path: "SKILL.md", sha256: "abc" }]);

    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          skillId: "skills:1",
          versionId: "skillVersions:1",
          versionFingerprint: undefined,
          files: [{ path: "SKILL.md", sha256: "abc" }],
          existingEntries: [],
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn().mockResolvedValue({ ok: true });

    const result = await backfillSkillFingerprintsInternalHandler(
      { runQuery, runMutation } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1 },
    );

    expect(result.ok).toBe(true);
    expect(result.stats.versionsScanned).toBe(1);
    expect(result.stats.versionsPatched).toBe(1);
    expect(result.stats.fingerprintsInserted).toBe(1);
    expect(result.stats.fingerprintMismatches).toBe(0);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      versionId: "skillVersions:1",
      fingerprint: expected,
      patchVersion: true,
      replaceEntries: true,
      existingEntryIds: [],
    });
  });

  it("dryRun does not patch", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          skillId: "skills:1",
          versionId: "skillVersions:1",
          versionFingerprint: undefined,
          files: [{ path: "SKILL.md", sha256: "abc" }],
          existingEntries: [],
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn();

    const result = await backfillSkillFingerprintsInternalHandler(
      { runQuery, runMutation } as never,
      { dryRun: true, batchSize: 10, maxBatches: 1 },
    );

    expect(result.ok).toBe(true);
    expect(result.stats.versionsPatched).toBe(1);
    expect(result.stats.fingerprintsInserted).toBe(1);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("patches missing version fingerprint without touching correct entries", async () => {
    const { hashSkillFiles } = await import("./lib/skills");
    const expected = await hashSkillFiles([{ path: "SKILL.md", sha256: "abc" }]);

    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          skillId: "skills:1",
          versionId: "skillVersions:1",
          versionFingerprint: undefined,
          files: [{ path: "SKILL.md", sha256: "abc" }],
          existingEntries: [{ id: "skillVersionFingerprints:1", fingerprint: expected }],
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn().mockResolvedValue({ ok: true });

    const result = await backfillSkillFingerprintsInternalHandler(
      { runQuery, runMutation } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1 },
    );

    expect(result.ok).toBe(true);
    expect(result.stats.versionsPatched).toBe(1);
    expect(result.stats.fingerprintsInserted).toBe(0);
    expect(result.stats.fingerprintMismatches).toBe(0);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      versionId: "skillVersions:1",
      fingerprint: expected,
      patchVersion: true,
      replaceEntries: false,
      existingEntryIds: [],
    });
  });

  it("replaces mismatched fingerprint entries", async () => {
    const { hashSkillFiles } = await import("./lib/skills");
    const expected = await hashSkillFiles([{ path: "SKILL.md", sha256: "abc" }]);

    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          skillId: "skills:1",
          versionId: "skillVersions:1",
          versionFingerprint: "wrong",
          files: [{ path: "SKILL.md", sha256: "abc" }],
          existingEntries: [{ id: "skillVersionFingerprints:1", fingerprint: "wrong" }],
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn().mockResolvedValue({ ok: true });

    const result = await backfillSkillFingerprintsInternalHandler(
      { runQuery, runMutation } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1 },
    );

    expect(result.ok).toBe(true);
    expect(result.stats.fingerprintMismatches).toBe(1);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      versionId: "skillVersions:1",
      fingerprint: expected,
      patchVersion: true,
      replaceEntries: true,
      existingEntryIds: ["skillVersionFingerprints:1"],
    });
  });

  it("ignores generated Skill Cards and bundle fingerprints for source backfills", async () => {
    const { hashSkillFiles } = await import("./lib/skills");
    const sourceFingerprint = await hashSkillFiles([{ path: "SKILL.md", sha256: "abc" }]);
    const bundleFingerprint = await hashSkillFiles([
      { path: "SKILL.md", sha256: "abc" },
      { path: "skill-card.md", sha256: "def" },
    ]);

    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          skillId: "skills:1",
          versionId: "skillVersions:1",
          versionFingerprint: sourceFingerprint,
          files: [
            { path: "SKILL.md", sha256: "abc" },
            { path: "skill-card.md", sha256: "def" },
          ],
          hasGeneratedBundleFingerprint: true,
          existingEntries: [
            {
              id: "skillVersionFingerprints:source",
              fingerprint: sourceFingerprint,
              kind: "source",
            },
            {
              id: "skillVersionFingerprints:bundle",
              fingerprint: bundleFingerprint,
              kind: "generated-bundle",
            },
          ],
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn();

    const result = await backfillSkillFingerprintsInternalHandler(
      { runQuery, runMutation } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1 },
    );

    expect(result.ok).toBe(true);
    expect(result.stats.versionsPatched).toBe(0);
    expect(result.stats.fingerprintsInserted).toBe(0);
    expect(result.stats.fingerprintMismatches).toBe(0);
    expect(runMutation).not.toHaveBeenCalled();
  });
});

describe("maintenance empty skill cleanup", () => {
  it("dryRun detects empty skills and returns nominations", async () => {
    const runQuery = vi.fn().mockImplementation(async (endpoint: unknown) => {
      if (endpoint === internal.maintenance.getEmptySkillCleanupPageInternal) {
        return {
          items: [
            {
              skillId: "skills:1",
              slug: "spam-skill",
              ownerUserId: "users:1",
              latestVersionId: "skillVersions:1",
              softDeletedAt: undefined,
              summary: "Expert guidance for spam-skill.",
            },
          ],
          cursor: null,
          isDone: true,
        };
      }
      if (endpoint === internal.skills.getVersionByIdInternal) {
        return {
          _id: "skillVersions:1",
          files: [{ path: "SKILL.md", size: 120, storageId: "storage:1" }],
        };
      }
      if (endpoint === internal.users.getByIdInternal) {
        return { _id: "users:1", handle: "spammer", _creationTime: Date.now() };
      }
      if (endpoint === internal.skills.getOwnerSkillActivityInternal) {
        return [];
      }
      throw new Error(`Unexpected endpoint: ${String(endpoint)}`);
    });

    const runMutation = vi.fn();
    const storageGet = vi
      .fn()
      .mockResolvedValue(
        makeBlob(`# Demo\n- Step-by-step tutorials\n- Tips and techniques\n- Project ideas`),
      );

    const result = await cleanupEmptySkillsInternalHandler(
      { runQuery, runMutation, storage: { get: storageGet } } as never,
      { dryRun: true, batchSize: 10, maxBatches: 1, nominationThreshold: 1 },
    );

    expect(result.ok).toBe(true);
    expect(result.isDone).toBe(true);
    expect(result.cursor).toBeNull();
    expect(result.stats.emptyDetected).toBe(1);
    expect(result.stats.skillsDeleted).toBe(0);
    expect(result.nominations).toEqual([
      {
        userId: "users:1",
        handle: "spammer",
        emptySkillCount: 1,
        sampleSlugs: ["spam-skill"],
      },
    ]);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("apply mode deletes empty skills", async () => {
    const runQuery = vi.fn().mockImplementation(async (endpoint: unknown) => {
      if (endpoint === internal.maintenance.getEmptySkillCleanupPageInternal) {
        return {
          items: [
            {
              skillId: "skills:1",
              slug: "spam-a",
              ownerUserId: "users:1",
              latestVersionId: "skillVersions:1",
              summary: "Expert guidance for spam-a.",
            },
            {
              skillId: "skills:2",
              slug: "spam-b",
              ownerUserId: "users:1",
              latestVersionId: "skillVersions:2",
              summary: "Expert guidance for spam-b.",
            },
          ],
          cursor: null,
          isDone: true,
        };
      }
      if (endpoint === internal.skills.getVersionByIdInternal) {
        return {
          files: [{ path: "SKILL.md", size: 120, storageId: "storage:1" }],
        };
      }
      if (endpoint === internal.users.getByIdInternal) {
        return { _id: "users:1", handle: "spammer", _creationTime: Date.now() };
      }
      if (endpoint === internal.skills.getOwnerSkillActivityInternal) {
        return [];
      }
      throw new Error(`Unexpected endpoint: ${String(endpoint)}`);
    });

    const runMutation = vi.fn().mockImplementation(async (endpoint: unknown) => {
      if (endpoint === internal.maintenance.applyEmptySkillCleanupInternal) {
        return { deleted: true };
      }
      throw new Error(`Unexpected mutation endpoint: ${String(endpoint)}`);
    });

    const storageGet = vi
      .fn()
      .mockResolvedValue(
        makeBlob(`# Demo\n- Step-by-step tutorials\n- Tips and techniques\n- Project ideas`),
      );

    const result = await cleanupEmptySkillsInternalHandler(
      { runQuery, runMutation, storage: { get: storageGet } } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1, nominationThreshold: 2 },
    );

    expect(result.ok).toBe(true);
    expect(result.isDone).toBe(true);
    expect(result.cursor).toBeNull();
    expect(result.stats.emptyDetected).toBe(2);
    expect(result.stats.skillsDeleted).toBe(2);
    expect(result.nominations).toEqual([
      {
        userId: "users:1",
        handle: "spammer",
        emptySkillCount: 2,
        sampleSlugs: ["spam-a", "spam-b"],
      },
    ]);
  });
});

describe("maintenance empty skill nominations", () => {
  it("creates ban nominations from backfilled empty deletions", async () => {
    const runQuery = vi.fn().mockImplementation(async (endpoint: unknown, args: unknown) => {
      if (endpoint === internal.maintenance.getEmptySkillCleanupPageInternal) {
        const cursor = (args as { cursor?: string | undefined }).cursor;
        if (!cursor) {
          return {
            items: [
              {
                skillId: "skills:1",
                slug: "spam-a",
                ownerUserId: "users:1",
                softDeletedAt: 1,
                moderationReason: "quality.empty.backfill",
              },
              {
                skillId: "skills:2",
                slug: "spam-b",
                ownerUserId: "users:1",
                softDeletedAt: 1,
                moderationReason: "quality.empty.backfill",
              },
            ],
            cursor: "next",
            isDone: false,
          };
        }
        return {
          items: [
            {
              skillId: "skills:3",
              slug: "valid-hidden",
              ownerUserId: "users:2",
              softDeletedAt: 1,
              moderationReason: "scanner.vt.suspicious",
            },
          ],
          cursor: null,
          isDone: true,
        };
      }
      if (endpoint === internal.users.getByIdInternal) {
        return { _id: "users:1", handle: "spammer" };
      }
      throw new Error(`Unexpected query endpoint: ${String(endpoint)}`);
    });

    const runMutation = vi.fn().mockImplementation(async (endpoint: unknown) => {
      if (endpoint === internal.maintenance.nominateUserForEmptySkillSpamInternal) {
        return { created: true };
      }
      throw new Error(`Unexpected mutation endpoint: ${String(endpoint)}`);
    });

    const result = await nominateEmptySkillSpammersInternalHandler(
      { runQuery, runMutation } as never,
      { batchSize: 10, maxBatches: 2, nominationThreshold: 2 },
    );

    expect(result.ok).toBe(true);
    expect(result.isDone).toBe(true);
    expect(result.stats.usersFlagged).toBe(1);
    expect(result.stats.nominationsCreated).toBe(1);
    expect(result.stats.nominationsExisting).toBe(0);
    expect(result.nominations).toEqual([
      {
        userId: "users:1",
        handle: "spammer",
        emptySkillCount: 2,
        sampleSlugs: ["spam-a", "spam-b"],
      },
    ]);
  });
});
