/* @vitest-environment node */

import { getAuthUserId } from "@convex-dev/auth/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getStaffSecurityScanArtifact,
  getStaffSecurityScanOverview,
  listStaffSecurityScanArtifacts,
} from "./securityScanDigests";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
}));

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

type FakeRow = Record<string, unknown> & {
  _id: string;
  _creationTime: number;
};

type FakeTable =
  | "users"
  | "skills"
  | "skillVersions"
  | "packages"
  | "packageReleases"
  | "securityScanJobs"
  | "securityScanArtifactStates"
  | "securityScanCurrentRollups"
  | "securityScanHourlyRollups";

type OverviewResult = {
  window: {
    hours: number;
    rows: FakeRow[];
    totalsByKind: Record<
      string,
      {
        total: number;
        byScanJobStatus: Record<string, number>;
      }
    >;
  };
  current: Record<
    string,
    {
      totals: {
        total: number;
        byVerdict: Record<string, number>;
        byScanJobStatus: Record<string, number>;
        byFailureStatus: Record<string, number>;
      };
      rollups: Array<Record<string, unknown>>;
    }
  >;
  failed: {
    items: FakeRow[];
    limit: number;
  };
};

type ArtifactListResult = {
  items: FakeRow[];
  nextCursor: string | null;
  done: boolean;
  limit: number;
};

type ArtifactDetailResult = {
  found: boolean;
  artifactKind: "skill" | "plugin";
  reason?: string;
  state?: FakeRow | null;
  scanJob?: Record<string, unknown> | null;
  evidence?: {
    clawScan: Record<string, unknown>;
    skillSpector: {
      issueCount?: number;
      issues: unknown[];
    };
  };
};

const getStaffSecurityScanOverviewHandler = (
  getStaffSecurityScanOverview as unknown as WrappedHandler<
    { artifactKind?: "skill" | "plugin"; windowHours?: number; failedLimit?: number },
    OverviewResult
  >
)._handler;

const listStaffSecurityScanArtifactsHandler = (
  listStaffSecurityScanArtifacts as unknown as WrappedHandler<
    {
      artifactKind: "skill" | "plugin";
      cursor?: string | null;
      limit?: number;
      clawScanVerdict?: string;
      scanJobStatus?: string;
      failureStatus?: string;
      clawScanPrimaryCategoryKey?: string;
    },
    ArtifactListResult
  >
)._handler;

const getStaffSecurityScanArtifactHandler = (
  getStaffSecurityScanArtifact as unknown as WrappedHandler<
    { skillSlug?: string; packageName?: string },
    ArtifactDetailResult
  >
)._handler;

const NOW = Date.UTC(2026, 4, 26, 12, 30, 0);
const HOUR_MS = 60 * 60 * 1000;

class FakeDb {
  readonly tables: Record<FakeTable, FakeRow[]>;

  constructor(seed: Partial<Record<FakeTable, FakeRow[]>> = {}) {
    this.tables = {
      users: [],
      skills: [],
      skillVersions: [],
      packages: [],
      packageReleases: [],
      securityScanJobs: [],
      securityScanArtifactStates: [],
      securityScanCurrentRollups: [],
      securityScanHourlyRollups: [],
      ...seed,
    };
  }

  async get(id: string) {
    return (
      Object.values(this.tables)
        .flat()
        .find((tableRow) => tableRow._id === id) ?? null
    );
  }

  query(table: string) {
    const tableName = table as FakeTable;
    if (!this.tables[tableName]) throw new Error(`Unexpected table ${table}`);

    const filters: Array<
      { op: "eq"; field: string; value: unknown } | { op: "gte"; field: string; value: number }
    > = [];
    let indexName = "";
    let orderDirection: "asc" | "desc" | null = null;

    const range = {
      eq(field: string, value: unknown) {
        filters.push({ op: "eq", field, value });
        return range;
      },
      gte(field: string, value: number) {
        filters.push({ op: "gte", field, value });
        return range;
      },
    };

    const select = () => {
      const rows = this.tables[tableName].filter((tableRow) =>
        filters.every((filter) => {
          if (filter.op === "eq") return tableRow[filter.field] === filter.value;
          const value = tableRow[filter.field];
          return typeof value === "number" && value >= filter.value;
        }),
      );
      if (!orderDirection) return rows;
      const orderField = indexName.includes("bucket_start_ms") ? "bucketStartMs" : "updatedAt";
      return [...rows].sort((a, b) => {
        const left = typeof a[orderField] === "number" ? a[orderField] : 0;
        const right = typeof b[orderField] === "number" ? b[orderField] : 0;
        return orderDirection === "desc" ? right - left : left - right;
      });
    };

    const queryApi = {
      withIndex(name: string, buildRange: (q: typeof range) => unknown) {
        indexName = name;
        buildRange(range);
        return queryApi;
      },
      order(direction: "asc" | "desc") {
        orderDirection = direction;
        return queryApi;
      },
      async unique() {
        const matches = select();
        if (matches.length > 1) throw new Error(`Expected unique ${tableName} row`);
        return matches[0] ?? null;
      },
      async take(limit: number) {
        return select().slice(0, limit);
      },
      async paginate(opts: { cursor: string | null; numItems: number }) {
        const offset = opts.cursor ? Number(opts.cursor) : 0;
        const matches = select();
        const page = matches.slice(offset, offset + opts.numItems);
        const nextOffset = offset + page.length;
        const isDone = nextOffset >= matches.length;
        return {
          page,
          isDone,
          continueCursor: isDone ? null : String(nextOffset),
        };
      },
    };

    return queryApi;
  }
}

function fakeRow(_id: string, fields: Record<string, unknown>): FakeRow {
  return {
    _id,
    _creationTime: 1,
    ...fields,
  };
}

function user(id: string, role: "admin" | "moderator" | "user") {
  return fakeRow(`users:${id}`, { role });
}

function currentRollup(
  fields: Record<string, unknown> & {
    artifactKind: "skill" | "plugin";
    rollupKind: string;
    categoryKey: string;
    clawScanVerdict: string;
    scanJobStatus: string;
  },
) {
  return fakeRow(
    `securityScanCurrentRollups:${fields.artifactKind}:${fields.rollupKind}:${fields.categoryKey}:${fields.clawScanVerdict}:${fields.scanJobStatus}`,
    {
      categoryLabel: undefined,
      updatedAt: NOW - 1_000,
      ...fields,
    },
  );
}

function hourlyRollup(id: string, fields: Record<string, unknown>) {
  return fakeRow(`securityScanHourlyRollups:${id}`, {
    updatedAt: NOW - 1_000,
    ...fields,
  });
}

function artifactState(id: string, fields: Record<string, unknown>) {
  const artifactKind = fields.artifactKind === "plugin" ? "plugin" : "skill";
  return fakeRow(`securityScanArtifactStates:${id}`, {
    artifactKind,
    targetKind: artifactKind === "plugin" ? "packageRelease" : "skillVersion",
    artifactKey: `${artifactKind}:${id}`,
    targetKey: `${artifactKind === "plugin" ? "packageRelease" : "skillVersion"}:${id}`,
    ownerUserId: "users:owner",
    displayName: `Artifact ${id}`,
    clawScanVerdict: "pass",
    scanJobStatus: "succeeded",
    failureStatus: "none",
    createdAt: NOW - 10_000,
    updatedAt: NOW - 1_000,
    ...fields,
  });
}

function staffCtx(seed: Partial<Record<FakeTable, FakeRow[]>> = {}) {
  const db = new FakeDb({
    users: [user("admin", "admin"), user("moderator", "moderator"), user("reader", "user")],
    ...seed,
  });
  return { db, ctx: { db } };
}

function authenticate(userId: string | null) {
  vi.mocked(getAuthUserId).mockResolvedValue(userId as never);
}

function seedOverviewRows() {
  const failedSkill = artifactState("failed-skill", {
    artifactKind: "skill",
    artifactKey: "skill:failed",
    displayName: "Failed Skill",
    clawScanVerdict: "failed",
    scanJobStatus: "failed",
    failureStatus: "failed",
    lastError: "Worker timeout",
    updatedAt: NOW - 500,
  });
  const failedPlugin = artifactState("failed-plugin", {
    artifactKind: "plugin",
    artifactKey: "plugin:failed",
    displayName: "Failed Plugin",
    clawScanVerdict: "failed",
    scanJobStatus: "failed",
    failureStatus: "failed",
    lastError: "Worker crashed",
    updatedAt: NOW - 300,
  });

  return {
    securityScanArtifactStates: [failedSkill, failedPlugin],
    securityScanCurrentRollups: [
      currentRollup({
        artifactKind: "skill",
        rollupKind: "all",
        categoryKey: "all",
        clawScanVerdict: "pass",
        scanJobStatus: "succeeded",
        failureStatus: "none",
        count: 2,
      }),
      currentRollup({
        artifactKind: "skill",
        rollupKind: "all",
        categoryKey: "all",
        clawScanVerdict: "malicious",
        scanJobStatus: "succeeded",
        failureStatus: "none",
        count: 1,
      }),
      currentRollup({
        artifactKind: "skill",
        rollupKind: "all",
        categoryKey: "all",
        clawScanVerdict: "pending",
        scanJobStatus: "queued",
        failureStatus: "none",
        count: 4,
      }),
      currentRollup({
        artifactKind: "skill",
        rollupKind: "all",
        categoryKey: "all",
        clawScanVerdict: "unknown",
        scanJobStatus: "running",
        failureStatus: "none",
        count: 3,
      }),
      currentRollup({
        artifactKind: "skill",
        rollupKind: "all",
        categoryKey: "all",
        clawScanVerdict: "failed",
        scanJobStatus: "failed",
        failureStatus: "failed",
        count: 1,
      }),
      currentRollup({
        artifactKind: "skill",
        rollupKind: "clawscanCategory",
        categoryKey: "permission_boundary",
        categoryLabel: "Permission boundary",
        clawScanVerdict: "malicious",
        scanJobStatus: "succeeded",
        failureStatus: "none",
        count: 1,
      }),
      currentRollup({
        artifactKind: "plugin",
        rollupKind: "all",
        categoryKey: "all",
        clawScanVerdict: "pass",
        scanJobStatus: "succeeded",
        failureStatus: "none",
        count: 3,
      }),
      currentRollup({
        artifactKind: "plugin",
        rollupKind: "all",
        categoryKey: "all",
        clawScanVerdict: "failed",
        scanJobStatus: "failed",
        failureStatus: "failed",
        count: 1,
      }),
    ],
    securityScanHourlyRollups: [
      hourlyRollup("recent-pass", {
        bucketStartMs: NOW - HOUR_MS,
        artifactKind: "skill",
        clawScanVerdict: "pass",
        scanJobStatus: "succeeded",
        failureStatus: "none",
        count: 3,
      }),
      hourlyRollup("recent-queued", {
        bucketStartMs: NOW - 2 * HOUR_MS,
        artifactKind: "skill",
        clawScanVerdict: "pending",
        scanJobStatus: "queued",
        failureStatus: "none",
        count: 2,
      }),
      hourlyRollup("recent-plugin-failed", {
        bucketStartMs: NOW - 3 * HOUR_MS,
        artifactKind: "plugin",
        clawScanVerdict: "failed",
        scanJobStatus: "failed",
        failureStatus: "failed",
        count: 1,
      }),
      hourlyRollup("old-skill", {
        bucketStartMs: NOW - 48 * HOUR_MS,
        artifactKind: "skill",
        clawScanVerdict: "malicious",
        scanJobStatus: "succeeded",
        failureStatus: "none",
        count: 99,
      }),
    ],
  };
}

describe("staff security scan digest APIs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(getAuthUserId).mockReset();
  });

  it("allows admins and moderators to read overview data but rejects ordinary users", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const { ctx } = staffCtx();

    authenticate(null);
    await expect(getStaffSecurityScanOverviewHandler(ctx, {})).rejects.toThrow("Unauthorized");

    authenticate("users:reader");
    await expect(getStaffSecurityScanOverviewHandler(ctx, {})).rejects.toThrow("Forbidden");

    authenticate("users:moderator");
    await expect(getStaffSecurityScanOverviewHandler(ctx, {})).resolves.toMatchObject({
      window: { hours: 24 },
    });

    authenticate("users:admin");
    await expect(getStaffSecurityScanOverviewHandler(ctx, {})).resolves.toMatchObject({
      window: { hours: 24 },
    });
  });

  it("returns current rollups, percentage bases, recent window rows, and failed samples", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    authenticate("users:moderator");
    const { ctx } = staffCtx(seedOverviewRows());

    const result = await getStaffSecurityScanOverviewHandler(ctx, {
      windowHours: 24,
      failedLimit: 1,
    });

    expect(result.current.skill.totals).toMatchObject({
      total: 11,
      byVerdict: expect.objectContaining({
        pass: 2,
        malicious: 1,
        pending: 4,
        failed: 1,
      }),
      byScanJobStatus: expect.objectContaining({
        queued: 4,
        running: 3,
        failed: 1,
      }),
      byFailureStatus: expect.objectContaining({
        failed: 1,
      }),
    });
    expect(result.current.skill.rollups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rollupKind: "clawscanCategory",
          categoryKey: "permission_boundary",
          count: 1,
          totalForKind: 11,
          percentageBasis: 11,
        }),
      ]),
    );
    expect(result.window.totalsByKind.skill).toMatchObject({
      total: 5,
      byScanJobStatus: expect.objectContaining({ queued: 2, succeeded: 3 }),
    });
    expect(result.window.rows).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ count: 99 })]),
    );
    expect(result.failed.items).toMatchObject([
      {
        artifactKind: "plugin",
        displayName: "Failed Plugin",
        failureStatus: "failed",
      },
    ]);
    expect(result.failed.limit).toBe(1);
  });

  it("paginates artifact rows with indexed status filters and clamps page size", async () => {
    authenticate("users:moderator");
    const first = artifactState("plugin-old-failed", {
      artifactKind: "plugin",
      displayName: "Older Failed Plugin",
      failureStatus: "failed",
      scanJobStatus: "failed",
      clawScanVerdict: "failed",
      updatedAt: NOW - 10_000,
    });
    const second = artifactState("plugin-new-failed", {
      artifactKind: "plugin",
      displayName: "Newer Failed Plugin",
      failureStatus: "failed",
      scanJobStatus: "failed",
      clawScanVerdict: "failed",
      updatedAt: NOW - 100,
    });
    const pass = artifactState("plugin-pass", {
      artifactKind: "plugin",
      displayName: "Passing Plugin",
      failureStatus: "none",
      scanJobStatus: "succeeded",
      clawScanVerdict: "pass",
      updatedAt: NOW - 50,
    });
    const { ctx } = staffCtx({
      securityScanArtifactStates: [first, second, pass],
    });

    const firstPage = await listStaffSecurityScanArtifactsHandler(ctx, {
      artifactKind: "plugin",
      failureStatus: "failed",
      limit: 1,
    });

    expect(firstPage).toMatchObject({
      items: [expect.objectContaining({ displayName: "Newer Failed Plugin" })],
      nextCursor: "1",
      done: false,
      limit: 1,
    });

    const secondPage = await listStaffSecurityScanArtifactsHandler(ctx, {
      artifactKind: "plugin",
      failureStatus: "failed",
      cursor: firstPage.nextCursor,
      limit: 999,
    });

    expect(secondPage).toMatchObject({
      items: [expect.objectContaining({ displayName: "Older Failed Plugin" })],
      nextCursor: null,
      done: true,
      limit: 100,
    });

    await expect(
      listStaffSecurityScanArtifactsHandler(ctx, {
        artifactKind: "plugin",
        failureStatus: "failed",
        scanJobStatus: "failed",
      }),
    ).rejects.toThrow("Provide at most one security scan artifact filter");
  });

  it("looks up a skill by slug with state, evidence summary, and sanitized scan job details", async () => {
    authenticate("users:admin");
    const issues = Array.from({ length: 12 }, (_, index) => ({
      issueId: `issue-${index}`,
      severity: "high",
      explanation: "Risky tool use",
    }));
    const { ctx } = staffCtx({
      skills: [
        fakeRow("skills:demo", {
          slug: "demo-skill",
          displayName: "Demo Skill",
          ownerUserId: "users:owner",
          latestVersionId: "skillVersions:demo",
        }),
      ],
      skillVersions: [
        fakeRow("skillVersions:demo", {
          skillId: "skills:demo",
          version: "1.2.3",
          createdAt: NOW - 5_000,
          llmAnalysis: {
            status: "malicious",
            verdict: "malicious",
            confidence: "high",
            summary: "Exfiltrates secrets",
            checkedAt: NOW - 1_000,
          },
          skillSpectorAnalysis: {
            status: "suspicious",
            score: 85,
            severity: "high",
            recommendation: "block",
            issueCount: issues.length,
            checkedAt: NOW - 900,
            issues,
          },
        }),
      ],
      securityScanArtifactStates: [
        artifactState("demo-skill", {
          artifactKind: "skill",
          artifactKey: "skill:skills:demo",
          targetKey: "skillVersion:skillVersions:demo",
          skillId: "skills:demo",
          skillVersionId: "skillVersions:demo",
          slug: "demo-skill",
          displayName: "Demo Skill",
          version: "1.2.3",
          clawScanVerdict: "malicious",
          scanJobStatus: "succeeded",
          lastScanJobId: "securityScanJobs:demo",
        }),
      ],
      securityScanJobs: [
        fakeRow("securityScanJobs:demo", {
          status: "succeeded",
          targetKind: "skillVersion",
          skillVersionId: "skillVersions:demo",
          source: "manual",
          priority: 100,
          hasMaliciousSignal: true,
          waitForVtUntil: 0,
          nextRunAt: NOW - 4_000,
          attempts: 2,
          leaseToken: "internal-secret-token",
          leaseExpiresAt: NOW - 3_000,
          workerId: "worker-a",
          runId: "run-a",
          completedAt: NOW - 2_000,
          createdAt: NOW - 4_000,
          updatedAt: NOW - 2_000,
        }),
      ],
    });

    const detail = await getStaffSecurityScanArtifactHandler(ctx, { skillSlug: "demo-skill" });

    expect(detail).toMatchObject({
      found: true,
      artifactKind: "skill",
      state: expect.objectContaining({
        slug: "demo-skill",
        clawScanVerdict: "malicious",
      }),
      scanJob: expect.objectContaining({
        _id: "securityScanJobs:demo",
        attempts: 2,
        workerId: "worker-a",
      }),
      evidence: {
        clawScan: expect.objectContaining({
          verdict: "malicious",
          summary: "Exfiltrates secrets",
        }),
        skillSpector: expect.objectContaining({
          issueCount: 12,
          issues: expect.any(Array),
        }),
      },
    });
    expect(detail.scanJob).not.toHaveProperty("leaseToken");
    expect(detail.evidence?.skillSpector.issues).toHaveLength(10);
  });

  it("looks up plugins by normalized package name and returns missing artifacts cleanly", async () => {
    authenticate("users:moderator");
    const { ctx } = staffCtx({
      packages: [
        fakeRow("packages:demo-plugin", {
          name: "@openclaw/demo-plugin",
          normalizedName: "@openclaw/demo-plugin",
          displayName: "Demo Plugin",
          ownerUserId: "users:owner",
          family: "code-plugin",
          latestReleaseId: "packageReleases:demo-plugin",
        }),
      ],
      packageReleases: [
        fakeRow("packageReleases:demo-plugin", {
          packageId: "packages:demo-plugin",
          version: "2.0.0",
          createdAt: NOW - 5_000,
          llmAnalysis: {
            status: "clean",
            verdict: "benign",
            checkedAt: NOW - 1_000,
          },
        }),
      ],
      securityScanArtifactStates: [
        artifactState("demo-plugin", {
          artifactKind: "plugin",
          artifactKey: "plugin:packages:demo-plugin",
          targetKey: "packageRelease:packageReleases:demo-plugin",
          packageId: "packages:demo-plugin",
          packageReleaseId: "packageReleases:demo-plugin",
          name: "@openclaw/demo-plugin",
          displayName: "Demo Plugin",
          version: "2.0.0",
          clawScanVerdict: "pass",
        }),
      ],
    });

    const detail = await getStaffSecurityScanArtifactHandler(ctx, {
      packageName: "@OPENCLAW/Demo-Plugin",
    });

    expect(detail).toMatchObject({
      found: true,
      artifactKind: "plugin",
      state: expect.objectContaining({
        name: "@openclaw/demo-plugin",
        clawScanVerdict: "pass",
      }),
      evidence: {
        clawScan: expect.objectContaining({
          verdict: "benign",
        }),
      },
    });

    await expect(
      getStaffSecurityScanArtifactHandler(ctx, { skillSlug: "missing-skill" }),
    ).resolves.toMatchObject({
      found: false,
      artifactKind: "skill",
      reason: "missing",
    });
  });
});
