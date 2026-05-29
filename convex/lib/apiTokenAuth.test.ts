import { getAuthUserId } from "@convex-dev/auth/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLOCKED_API_TOKEN_ACCOUNT_MESSAGE,
  INVALID_API_TOKEN_MESSAGE,
  MISSING_API_TOKEN_MESSAGE,
  getOptionalApiTokenUserId,
  requireApiTokenUser,
  requirePackagePublishAuth,
} from "./apiTokenAuth";
import { hashToken } from "./tokens";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(getAuthUserId).mockReset();
});

describe("getOptionalApiTokenUserId", () => {
  it("returns null when auth header is missing", async () => {
    const ctx = {
      runQuery: vi.fn(),
    };
    const request = new Request("https://example.com");

    const userId = await getOptionalApiTokenUserId(ctx as never, request);

    expect(userId).toBeNull();
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it("returns null for unknown token", async () => {
    const ctx = {
      runQuery: vi.fn().mockResolvedValue(null),
    };
    const request = new Request("https://example.com", {
      headers: { authorization: "Bearer token-1" },
    });

    const userId = await getOptionalApiTokenUserId(ctx as never, request);

    expect(userId).toBeNull();
    expect(ctx.runQuery).toHaveBeenCalledTimes(1);
    expect(ctx.runQuery.mock.calls[0]?.[1]).toEqual({
      tokenHash: await hashToken("token-1"),
    });
  });

  it("returns user id when token and user are valid", async () => {
    const tokenId = "apiTokens_1";
    const expectedUserId = "users_1";
    const ctx = {
      runQuery: vi
        .fn()
        .mockImplementation(async (_fn, args: { tokenHash?: string; tokenId?: string }) => {
          if (args.tokenHash) {
            return { _id: tokenId, revokedAt: undefined };
          }
          if (args.tokenId) {
            return { _id: expectedUserId, deletedAt: undefined };
          }
          return null;
        }),
    };
    const request = new Request("https://example.com", {
      headers: { authorization: "Bearer token-2" },
    });

    const userId = await getOptionalApiTokenUserId(ctx as never, request);

    expect(userId).toBe(expectedUserId);
    expect(ctx.runQuery).toHaveBeenCalledTimes(2);
  });

  it("returns null when user is deleted", async () => {
    const tokenId = "apiTokens_2";
    const ctx = {
      runQuery: vi
        .fn()
        .mockImplementation(async (_fn, args: { tokenHash?: string; tokenId?: string }) => {
          if (args.tokenHash) {
            return { _id: tokenId, revokedAt: undefined };
          }
          if (args.tokenId) {
            return { _id: "users_deleted", deletedAt: Date.now() };
          }
          return null;
        }),
    };
    const request = new Request("https://example.com", {
      headers: { authorization: "Bearer token-3" },
    });

    const userId = await getOptionalApiTokenUserId(ctx as never, request);

    expect(userId).toBeNull();
    expect(ctx.runQuery).toHaveBeenCalledTimes(2);
  });

  it("returns null when user is deactivated", async () => {
    const tokenId = "apiTokens_3";
    const ctx = {
      runQuery: vi
        .fn()
        .mockImplementation(async (_fn, args: { tokenHash?: string; tokenId?: string }) => {
          if (args.tokenHash) {
            return { _id: tokenId, revokedAt: undefined };
          }
          if (args.tokenId) {
            return { _id: "users_deactivated", deactivatedAt: Date.now() };
          }
          return null;
        }),
    };
    const request = new Request("https://example.com", {
      headers: { authorization: "Bearer token-4" },
    });

    const userId = await getOptionalApiTokenUserId(ctx as never, request);

    expect(userId).toBeNull();
    expect(ctx.runQuery).toHaveBeenCalledTimes(2);
  });
});

describe("requireApiTokenUser", () => {
  it("explains missing tokens", async () => {
    const ctx = { runQuery: vi.fn(), runMutation: vi.fn() };

    await expect(
      requireApiTokenUser(ctx as never, new Request("https://example.com")),
    ).rejects.toThrow(MISSING_API_TOKEN_MESSAGE);
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it("explains invalid or revoked tokens", async () => {
    const ctx = { runQuery: vi.fn().mockResolvedValue(null), runMutation: vi.fn() };

    await expect(
      requireApiTokenUser(
        ctx as never,
        new Request("https://example.com", { headers: { authorization: "Bearer token-5" } }),
      ),
    ).rejects.toThrow(INVALID_API_TOKEN_MESSAGE);
  });

  it("explains tokens whose account is not in good standing", async () => {
    const ctx = {
      runQuery: vi
        .fn()
        .mockImplementation(async (_fn, args: { tokenHash?: string; tokenId?: string }) => {
          if (args.tokenHash) return { _id: "apiTokens_4", revokedAt: undefined };
          if (args.tokenId) return { _id: "users_blocked", deletedAt: Date.now() };
          return null;
        }),
      runMutation: vi.fn(),
    };

    await expect(
      requireApiTokenUser(
        ctx as never,
        new Request("https://example.com", { headers: { authorization: "Bearer token-6" } }),
      ),
    ).rejects.toThrow(BLOCKED_API_TOKEN_ACCOUNT_MESSAGE);
  });
});

describe("requirePackagePublishAuth", () => {
  it("accepts API tokens and touches token usage metadata", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue(null as never);
    const tokenId = "apiTokens_5";
    const userId = "users_api";
    let tokenHashLookups = 0;
    const ctx = {
      runQuery: vi
        .fn()
        .mockImplementation(async (_fn, args: { tokenHash?: string; tokenId?: string }) => {
          if (args.tokenHash) {
            tokenHashLookups += 1;
            return tokenHashLookups === 1 ? null : { _id: tokenId, revokedAt: undefined };
          }
          if (args.tokenId === tokenId) {
            return {
              _id: userId,
              deletedAt: undefined,
              deactivatedAt: undefined,
              role: "user",
            };
          }
          return null;
        }),
      runMutation: vi.fn(),
    };

    const auth = await requirePackagePublishAuth(
      ctx as never,
      new Request("https://example.com", {
        headers: { authorization: "Bearer clh_api_token" },
      }),
    );

    expect(auth).toMatchObject({ kind: "user", userId });
    expect(ctx.runMutation).toHaveBeenCalledWith(expect.anything(), { tokenId });
  });

  it("accepts a Convex auth session token for browser multipart publishes", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users_session" as never);
    const ctx = {
      runQuery: vi
        .fn()
        .mockImplementation(async (_fn, args: { tokenHash?: string; userId?: string }) => {
          if (args.tokenHash) return null;
          if (args.userId) {
            return { _id: args.userId, deletedAt: undefined, deactivatedAt: undefined };
          }
          return null;
        }),
      runMutation: vi.fn(),
    };

    const auth = await requirePackagePublishAuth(
      ctx as never,
      new Request("https://example.com", {
        headers: { authorization: "Bearer convex-session-token" },
      }),
    );

    expect(auth).toMatchObject({ kind: "user", userId: "users_session" });
  });

  it.each(["deletedAt", "deactivatedAt"] as const)(
    "rejects Convex auth session tokens for users with %s",
    async (blockedField) => {
      vi.mocked(getAuthUserId).mockResolvedValue("users_blocked" as never);
      const ctx = {
        runQuery: vi
          .fn()
          .mockImplementation(async (_fn, args: { tokenHash?: string; userId?: string }) => {
            if (args.tokenHash) return null;
            if (args.userId) {
              return {
                _id: args.userId,
                deletedAt: blockedField === "deletedAt" ? Date.now() : undefined,
                deactivatedAt: blockedField === "deactivatedAt" ? Date.now() : undefined,
              };
            }
            return null;
          }),
        runMutation: vi.fn(),
      };

      await expect(
        requirePackagePublishAuth(
          ctx as never,
          new Request("https://example.com", {
            headers: { authorization: "Bearer convex-session-token" },
          }),
        ),
      ).rejects.toThrow();
      expect(ctx.runMutation).not.toHaveBeenCalled();
    },
  );

  it("rejects an unknown bearer token without a valid session", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue(null as never);
    const ctx = {
      runQuery: vi.fn().mockResolvedValue(null),
      runMutation: vi.fn(),
    };

    await expect(
      requirePackagePublishAuth(
        ctx as never,
        new Request("https://example.com", {
          headers: { authorization: "Bearer bad-token" },
        }),
      ),
    ).rejects.toThrow(INVALID_API_TOKEN_MESSAGE);
  });
});
