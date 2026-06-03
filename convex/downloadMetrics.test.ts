/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __test,
  listDailyRollupsForSnapshotInternal,
  pruneDownloadMetricDedupesInternal,
  recordDownloadMetricInternal,
  writeGlobalWeeklySnapshotInternal,
  writeWeeklyTargetSnapshotsInternal,
} from "./downloadMetrics";

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const recordDownloadMetricHandler = (
  recordDownloadMetricInternal as unknown as WrappedHandler<
    {
      target: { kind: "skill"; id: string } | { kind: "package"; id: string };
      identityKind: "user" | "ip";
      identityHash: string;
      dayStart: number;
      occurredAt?: number;
    },
    void
  >
)._handler;

const listDailyRollupsForSnapshotHandler = (
  listDailyRollupsForSnapshotInternal as unknown as WrappedHandler<
    { weekStart: number; paginationOpts: { cursor: string | null; numItems: number } },
    unknown
  >
)._handler;

const pruneDownloadMetricDedupesHandler = (
  pruneDownloadMetricDedupesInternal as unknown as WrappedHandler<
    Record<string, never>,
    { deleted: number; hasMore: boolean }
  >
)._handler;

const writeWeeklyTargetSnapshotsHandler = (
  writeWeeklyTargetSnapshotsInternal as unknown as WrappedHandler<
    {
      weekStart: number;
      snapshots: Array<{
        targetKind: "skill" | "package";
        targetId: string;
        downloads: number;
      }>;
    },
    { snapshotsWritten: number }
  >
)._handler;

const writeGlobalWeeklySnapshotHandler = (
  writeGlobalWeeklySnapshotInternal as unknown as WrappedHandler<
    {
      weekStart: number;
      downloads: number;
      targetCount: number;
    },
    void
  >
)._handler;

function makeQueryBuilder() {
  const builder = {
    eq: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    lt: vi.fn(() => builder),
  };
  return builder;
}

type QueryBuilder = ReturnType<typeof makeQueryBuilder>;

function makeDb(
  existingByTable: Record<string, unknown> = {},
  rowsByTable: Record<string, Array<{ _id: string }>> = {},
) {
  const indexCalls: Array<{ table: string; indexName: string; builder: QueryBuilder }> = [];
  const insert = vi.fn();
  const patch = vi.fn();
  const unique = vi.fn(async function uniqueForTable(this: { table: string }) {
    return existingByTable[this.table] ?? null;
  });
  const paginate = vi.fn(async () => ({
    page: [],
    isDone: true,
    continueCursor: null,
  }));
  const take = vi.fn(async function takeForTable(this: { table: string }, limit: number) {
    return (rowsByTable[this.table] ?? []).slice(0, limit);
  });
  const query = vi.fn((table: string) => ({
    withIndex: vi.fn((_indexName: string, buildQuery: (q: unknown) => unknown) => {
      const builder = makeQueryBuilder();
      buildQuery(builder);
      indexCalls.push({ table, indexName: _indexName, builder });
      return {
        unique: unique.bind({ table }),
        paginate,
        take: take.bind({ table }),
      };
    }),
  }));
  const get = vi.fn();
  const replace = vi.fn();
  const delete_ = vi.fn();
  return {
    db: {
      query,
      get,
      insert,
      patch,
      replace,
      delete: delete_,
      normalizeId: vi.fn(),
      system: {
        get: vi.fn(),
        query: vi.fn(),
      },
    },
    insert,
    patch,
    paginate,
    delete_,
    take,
    indexCalls,
  };
}

describe("download metric helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("hashes user and ip identities with HMAC and separate domains", async () => {
    vi.stubEnv("DOWNLOAD_METERING_HMAC_SECRET", "test-secret");

    const userHash = await __test.hashDownloadIdentity("user", "203.0.113.10");
    const ipHash = await __test.hashDownloadIdentity("ip", "203.0.113.10");

    expect(userHash).toMatch(/^[a-f0-9]{64}$/);
    expect(ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(userHash).not.toBe(ipHash);
  });

  it("fails closed when the HMAC secret is missing", async () => {
    await expect(__test.hashDownloadIdentity("ip", "203.0.113.10")).rejects.toThrow(
      "DOWNLOAD_METERING_HMAC_SECRET",
    );
  });

  it("uses a day bucket for download dedupe", () => {
    expect(__test.getDayStart(86_400_000 - 1)).toBe(0);
    expect(__test.getDayStart(86_400_000)).toBe(86_400_000);
  });

  it("does not create a metering identity when user and IP are missing", () => {
    expect(__test.getDownloadIdentity(new Request("https://example.com"), null)).toBeNull();
  });

  it("records one authenticated skill download and emits the legacy skill stat event", async () => {
    const { db, insert, patch } = makeDb();

    await recordDownloadMetricHandler(
      { db },
      {
        target: { kind: "skill", id: "skills:one" },
        identityKind: "user",
        identityHash: "hash-user",
        dayStart: 86_400_000,
        occurredAt: 86_500_000,
      },
    );

    expect(insert).toHaveBeenCalledWith(
      "downloadMetricDedupes",
      expect.objectContaining({
        targetKind: "skill",
        targetId: "skills:one",
        identityKind: "user",
        identityHash: "hash-user",
        dayStart: 86_400_000,
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "downloadMetricDailyRollups",
      expect.objectContaining({
        targetKind: "skill",
        targetId: "skills:one",
        dayStart: 86_400_000,
        downloads: 1,
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "skillStatEvents",
      expect.objectContaining({
        skillId: "skills:one",
        kind: "download",
        occurredAt: 86_500_000,
      }),
    );
    expect(patch).not.toHaveBeenCalled();
  });

  it("records one anonymous package download and emits the legacy package stat event", async () => {
    const { db, insert } = makeDb();

    await recordDownloadMetricHandler(
      { db },
      {
        target: { kind: "package", id: "packages:one" },
        identityKind: "ip",
        identityHash: "hash-ip",
        dayStart: 86_400_000,
        occurredAt: 86_500_000,
      },
    );

    expect(insert).toHaveBeenCalledWith(
      "downloadMetricDailyRollups",
      expect.objectContaining({
        targetKind: "package",
        targetId: "packages:one",
        dayStart: 86_400_000,
        downloads: 1,
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "packageStatEvents",
      expect.objectContaining({
        packageId: "packages:one",
        kind: "download",
        occurredAt: 86_500_000,
      }),
    );
  });

  it("records authenticated package downloads with the same counter shape", async () => {
    const { db, insert } = makeDb();

    await recordDownloadMetricHandler(
      { db },
      {
        target: { kind: "package", id: "packages:one" },
        identityKind: "user",
        identityHash: "hash-user",
        dayStart: 86_400_000,
      },
    );

    expect(insert).toHaveBeenCalledWith(
      "downloadMetricDailyRollups",
      expect.objectContaining({
        targetKind: "package",
        targetId: "packages:one",
        downloads: 1,
      }),
    );
  });

  it("appends a daily metric row instead of patching an existing target/day row", async () => {
    const { db, insert, patch } = makeDb({
      downloadMetricDailyRollups: {
        _id: "downloadMetricDailyRollups:existing",
        downloads: 1,
      },
    });

    await recordDownloadMetricHandler(
      { db },
      {
        target: { kind: "package", id: "packages:one" },
        identityKind: "ip",
        identityHash: "hash-ip",
        dayStart: 86_400_000,
      },
    );

    expect(insert).toHaveBeenCalledWith(
      "downloadMetricDailyRollups",
      expect.objectContaining({
        targetKind: "package",
        targetId: "packages:one",
        dayStart: 86_400_000,
        downloads: 1,
      }),
    );
    expect(patch).not.toHaveBeenCalledWith(
      "downloadMetricDailyRollups:existing",
      expect.anything(),
    );
  });

  it("ignores duplicate identities in the same target/day bucket", async () => {
    const { db, insert, patch } = makeDb({
      downloadMetricDedupes: { _id: "downloadMetricDedupes:existing" },
    });

    await recordDownloadMetricHandler(
      { db },
      {
        target: { kind: "skill", id: "skills:one" },
        identityKind: "ip",
        identityHash: "hash-ip",
        dayStart: 86_400_000,
      },
    );

    expect(insert).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("prunes stale dedupe rows by day bucket", async () => {
    vi.setSystemTime(30 * 86_400_000);
    const { db, delete_, take } = makeDb(
      {},
      {
        downloadMetricDedupes: [
          { _id: "downloadMetricDedupes:one" },
          { _id: "downloadMetricDedupes:two" },
        ],
      },
    );

    const result = await pruneDownloadMetricDedupesHandler({ db }, {});

    expect(result).toEqual({ deleted: 2, hasMore: false });
    expect(take).toHaveBeenCalledWith(200);
    expect(delete_).toHaveBeenCalledWith("downloadMetricDedupes:one");
    expect(delete_).toHaveBeenCalledWith("downloadMetricDedupes:two");
  });

  it("reschedules stale dedupe pruning when one bounded batch fills", async () => {
    vi.setSystemTime(30 * 86_400_000);
    const rows = Array.from({ length: 200 }, (_, index) => ({
      _id: `downloadMetricDedupes:${index}`,
    }));
    const { db, delete_ } = makeDb({}, { downloadMetricDedupes: rows });
    const runAfter = vi.fn();

    const result = await pruneDownloadMetricDedupesHandler({ db, scheduler: { runAfter } }, {});

    expect(result).toEqual({ deleted: 200, hasMore: true });
    expect(delete_).toHaveBeenCalledTimes(200);
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), {});
  });

  it("aggregates daily rollups into weekly target snapshots", () => {
    expect(
      __test.aggregateWeeklySnapshots([
        {
          targetKind: "skill",
          targetId: "skills:one",
          downloads: 5,
        },
        {
          targetKind: "skill",
          targetId: "skills:one",
          downloads: 5,
        },
        {
          targetKind: "package",
          targetId: "packages:one",
          downloads: 6,
        },
      ]),
    ).toEqual([
      {
        targetKind: "skill",
        targetId: "skills:one",
        downloads: 10,
      },
      {
        targetKind: "package",
        targetId: "packages:one",
        downloads: 6,
      },
    ]);
  });

  it("folds paginated daily rollups into weekly snapshots without retaining pages", async () => {
    const pages = [
      {
        page: [
          {
            targetKind: "skill",
            targetId: "skills:one",
            downloads: 2,
          },
          {
            targetKind: "skill",
            targetId: "skills:one",
            downloads: 1,
          },
        ],
        isDone: false,
        continueCursor: "next-page",
      },
      {
        page: [
          {
            targetKind: "package",
            targetId: "packages:one",
            downloads: 4,
          },
        ],
        isDone: true,
        continueCursor: "",
      },
    ];
    const runQuery = vi.fn(async () => pages.shift());
    const runMutation = vi.fn(async () => {});

    const result = await __test.snapshotDownloadMetricsForWeek(
      { runQuery, runMutation } as never,
      345_600_000,
      500,
    );

    expect(result).toEqual({
      weekStart: 345_600_000,
      targetCount: 2,
      downloads: 7,
    });
    expect(runQuery).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        paginationOpts: { cursor: null, numItems: 500 },
      }),
    );
    expect(runQuery).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        paginationOpts: { cursor: "next-page", numItems: 500 },
      }),
    );
    expect(runMutation).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        snapshots: [
          {
            targetKind: "skill",
            targetId: "skills:one",
            downloads: 3,
          },
          {
            targetKind: "package",
            targetId: "packages:one",
            downloads: 4,
          },
        ],
      }),
    );
    expect(runMutation).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        downloads: 7,
        targetCount: 2,
      }),
    );
  });

  it("paginates weekly snapshot source rows by bounded week range", async () => {
    const { db, paginate, indexCalls } = makeDb();

    await listDailyRollupsForSnapshotHandler(
      { db },
      { weekStart: 345_600_000, paginationOpts: { cursor: null, numItems: 100 } },
    );

    const byDayCall = indexCalls.find(
      (call) => call.table === "downloadMetricDailyRollups" && call.indexName === "by_day",
    );
    expect(byDayCall).toBeDefined();
    if (!byDayCall) throw new Error("Expected downloadMetricDailyRollups by_day index query");
    expect(byDayCall.builder.gte).toHaveBeenCalledWith("dayStart", 345_600_000);
    expect(byDayCall.builder.lt).toHaveBeenCalledWith("dayStart", 950_400_000);
    expect(paginate).toHaveBeenCalledWith({ cursor: null, numItems: 100 });
  });

  it("upserts weekly target snapshots so reruns replace the same week", async () => {
    const { db, patch, insert } = makeDb({
      downloadMetricWeeklySnapshots: { _id: "downloadMetricWeeklySnapshots:existing" },
    });

    const result = await writeWeeklyTargetSnapshotsHandler(
      { db },
      {
        weekStart: 345_600_000,
        snapshots: [
          {
            targetKind: "skill",
            targetId: "skills:one",
            downloads: 10,
          },
        ],
      },
    );

    expect(result).toEqual({ snapshotsWritten: 1 });
    expect(patch).toHaveBeenCalledWith(
      "downloadMetricWeeklySnapshots:existing",
      expect.objectContaining({
        downloads: 10,
      }),
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it("upserts the global weekly snapshot", async () => {
    const { db, patch } = makeDb({
      downloadMetricGlobalWeeklySnapshots: { _id: "downloadMetricGlobalWeeklySnapshots:existing" },
    });

    await writeGlobalWeeklySnapshotHandler(
      { db },
      {
        weekStart: 345_600_000,
        downloads: 16,
        targetCount: 2,
      },
    );

    expect(patch).toHaveBeenCalledWith(
      "downloadMetricGlobalWeeklySnapshots:existing",
      expect.objectContaining({
        weekStart: 345_600_000,
        downloads: 16,
        targetCount: 2,
      }),
    );
  });
});
