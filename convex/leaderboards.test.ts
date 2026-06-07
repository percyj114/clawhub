/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import {
  rebuildTrendingLeaderboardAction,
  rebuildTrendingLeaderboardInternal,
} from "./leaderboards";
import { takeTopNonSuspiciousTrendingEntries } from "./lib/leaderboards";

const mutationHandler = (
  rebuildTrendingLeaderboardInternal as unknown as {
    _handler: (ctx: unknown, args: { limit?: number }) => Promise<unknown>;
  }
)._handler;
const actionHandler = (
  rebuildTrendingLeaderboardAction as unknown as {
    _handler: (ctx: unknown, args: { limit?: number }) => Promise<unknown>;
  }
)._handler;

describe("leaderboards.rebuildTrendingLeaderboardInternal", () => {
  it("schedules the action-based rebuild instead of reading daily stats inline", async () => {
    const runAfter = vi.fn().mockResolvedValue("job-1");
    const ctx = {
      db: {
        get: vi.fn(),
        insert: vi.fn(),
        normalizeId: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(),
        replace: vi.fn(),
        delete: vi.fn(),
        system: {
          get: vi.fn(),
          query: vi.fn(),
        },
      },
      scheduler: {
        runAfter,
      },
    } as never;

    const result = await mutationHandler(ctx, { limit: 500 });

    expect(runAfter).toHaveBeenCalledTimes(1);
    expect(runAfter.mock.calls[0]?.[0]).toBe(0);
    expect(runAfter.mock.calls[0]?.[2]).toEqual({ limit: 200 });
    expect(result).toEqual({ ok: true, count: 0, scheduled: true });
  });

  it("rebuild action pages daily stats instead of collecting a whole day", async () => {
    const runQuery = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if (Array.isArray(args.entries)) return args.entries;
      return {
        rows: [
          {
            skillId: "skills:one",
            installs: 1,
            downloads: 2,
          },
        ],
        isDone: true,
        continueCursor: "",
      };
    });
    const runMutation = vi.fn(async () => ({ ok: true }));

    const result = await actionHandler(
      {
        runQuery,
        runMutation,
      },
      { limit: 5 },
    );

    expect(result).toEqual({ ok: true, count: 1 });
    expect(runQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cursor: null, limit: 1000 }),
    );
    expect(runMutation).toHaveBeenCalledTimes(2);
  });
});

describe("takeTopNonSuspiciousTrendingEntries", () => {
  it("includes skills only flagged by retired dependency registry evidence", async () => {
    const get = vi.fn(async (id: string) => {
      if (id === "skills:retired-only") {
        return {
          _id: id,
          softDeletedAt: undefined,
          moderationStatus: "hidden",
          moderationReason: "scanner.aggregate.suspicious",
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
        };
      }
      if (id === "skills:active-suspicious") {
        return {
          _id: id,
          softDeletedAt: undefined,
          moderationStatus: "active",
          moderationReason: "scanner.aggregate.suspicious",
          moderationVerdict: "suspicious",
          moderationFlags: ["flagged.suspicious"],
          moderationReasonCodes: ["suspicious.dynamic_code_execution"],
          moderationEvidence: [],
          moderationSummary: "Detected: suspicious.dynamic_code_execution",
        };
      }
      return null;
    });

    const result = await takeTopNonSuspiciousTrendingEntries(
      { db: { get } } as never,
      [
        { skillId: "skills:active-suspicious" as never, score: 100, installs: 100, downloads: 0 },
        { skillId: "skills:retired-only" as never, score: 90, installs: 90, downloads: 0 },
      ],
      1,
    );

    expect(result).toEqual([
      { skillId: "skills:retired-only", score: 90, installs: 90, downloads: 0 },
    ]);
  });
});
