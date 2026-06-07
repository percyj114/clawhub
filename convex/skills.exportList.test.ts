/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

vi.mock("convex-helpers/server/pagination", async () => {
  const actual = await vi.importActual<typeof import("convex-helpers/server/pagination")>(
    "convex-helpers/server/pagination",
  );
  return {
    ...actual,
    getPage: vi.fn(),
  };
});

const pagination = await import("convex-helpers/server/pagination");
const { listByDateRange } = await import("./skills");

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

type ExportListResult = {
  page: Array<{ slug: string }>;
  hasMore: boolean;
  nextCursor: string | null;
};

const getPageMock = pagination.getPage as unknown as ReturnType<typeof vi.fn>;
const listByDateRangeHandler = (
  listByDateRange as unknown as WrappedHandler<
    { startDate: number; endDate: number; cursor?: string; numItems?: number },
    ExportListResult
  >
)._handler;

beforeEach(() => {
  getPageMock.mockReset();
});

function digest(overrides: Record<string, unknown>) {
  return {
    skillId: "skills:base",
    slug: "base",
    displayName: "Base",
    ownerUserId: "users:owner",
    latestVersionId: "skillVersions:base",
    tags: {},
    stats: {},
    softDeletedAt: undefined,
    moderationStatus: "active",
    moderationFlags: [],
    isSuspicious: false,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe("skills.listByDateRange export list", () => {
  it("uses updated cursors and returns only exportable public installable skills", async () => {
    getPageMock.mockResolvedValue({
      page: [
        digest({ slug: "exportable" }),
        digest({ slug: "missing-version", latestVersionId: undefined }),
        digest({ slug: "hidden", moderationStatus: "hidden" }),
        digest({ slug: "malicious", moderationFlags: ["blocked.malware"] }),
        digest({ slug: "deleted", softDeletedAt: 10 }),
      ],
      hasMore: false,
      indexKeys: [[undefined, 2]],
    });

    const result = await listByDateRangeHandler(
      { db: { get: vi.fn(async () => null) } },
      { startDate: 1, endDate: 5 },
    );

    expect(result.page.map((item) => item.slug)).toEqual(["exportable"]);
    expect(getPageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        table: "skillSearchDigest",
        index: "by_active_updated",
        startIndexKey: [undefined, 5],
        endIndexKey: [undefined, 1],
      }),
    );
  });

  it("exports rows hidden only by retired dependency registry moderation", async () => {
    getPageMock.mockResolvedValue({
      page: [
        digest({
          skillId: "skills:retired-only",
          slug: "retired-only",
          moderationStatus: "hidden",
          moderationReason: "scanner.aggregate.suspicious",
          moderationFlags: ["flagged.suspicious"],
          isSuspicious: true,
        }),
        digest({
          skillId: "skills:malicious",
          slug: "malicious",
          moderationStatus: "hidden",
          moderationReason: "scanner.llm.malicious",
          moderationFlags: ["blocked.malware"],
          isSuspicious: true,
        }),
      ],
      hasMore: false,
      indexKeys: [[undefined, 2]],
    });
    const get = vi.fn(async (id: string) => {
      if (id === "skills:retired-only") {
        return {
          moderationStatus: "hidden",
          moderationReason: "scanner.aggregate.suspicious",
          moderationReasonCodes: ["suspicious.dep_not_found_on_registry"],
          moderationSummary: "Detected: suspicious.dep_not_found_on_registry",
          moderationVerdict: "suspicious",
          moderationFlags: ["flagged.suspicious"],
          isSuspicious: true,
          softDeletedAt: undefined,
        };
      }
      if (id === "skills:malicious") {
        return {
          moderationStatus: "hidden",
          moderationReason: "scanner.llm.malicious",
          moderationReasonCodes: ["suspicious.dep_not_found_on_registry"],
          moderationSummary: "Detected: suspicious.dep_not_found_on_registry",
          moderationVerdict: "malicious",
          moderationFlags: ["blocked.malware"],
          isSuspicious: true,
          softDeletedAt: undefined,
        };
      }
      return null;
    });

    const result = await listByDateRangeHandler({ db: { get } }, { startDate: 1, endDate: 5 });

    expect(result.page.map((item) => item.slug)).toEqual(["retired-only"]);
    expect(get).toHaveBeenCalledWith("skills:retired-only");
    expect(get).toHaveBeenCalledWith("skills:malicious");
  });

  it("caps requested export list pages at 250 rows", async () => {
    getPageMock.mockResolvedValue({
      page: [],
      hasMore: false,
      indexKeys: [],
    });

    await listByDateRangeHandler({ db: {} }, { startDate: 1, endDate: 5, numItems: 1_000 });

    expect(getPageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        absoluteMaxRows: 250,
      }),
    );
  });
});
