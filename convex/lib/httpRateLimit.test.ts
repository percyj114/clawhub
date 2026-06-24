/* @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyRateLimit, getClientIp, RATE_LIMITS } from "./httpRateLimit";

type MockRateLimitStatus = {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
};

type MockRateLimitPlan = {
  ip: MockRateLimitStatus;
  user?: MockRateLimitStatus;
  tokenValid?: boolean;
  userActive?: boolean;
  userRole?: "admin" | "moderator" | "user" | null;
};

function makeRateLimitCtx(plan: MockRateLimitPlan) {
  const runQuery = vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
    if ("tokenHash" in args) {
      if (plan.tokenValid === false) return null;
      return { _id: "token_1", revokedAt: undefined };
    }
    if ("tokenId" in args) {
      if (plan.userActive === false) return null;
      return {
        _id: "users_123",
        deletedAt: undefined,
        deactivatedAt: undefined,
        role: plan.userRole ?? "user",
      };
    }
    if ("key" in args && "limit" in args && "windowMs" in args) {
      const key = String(args.key);
      if (key.startsWith("ip:")) return plan.ip;
      if (key.startsWith("user:")) return plan.user;
    }
    throw new Error(`Unexpected runQuery args: ${JSON.stringify(args)}`);
  });

  const runMutation = vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
    const key = String(args.key);
    const source = key.startsWith("user:") ? plan.user : plan.ip;
    if (!source) throw new Error(`Missing rate limit source for ${key}`);
    return {
      allowed: source.allowed,
      remaining: Math.max(0, source.remaining - (source.allowed ? 1 : 0)),
    };
  });

  return {
    runQuery,
    runMutation,
  } as unknown as Parameters<typeof applyRateLimit>[0];
}

describe("getClientIp", () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.TRUST_FORWARDED_IPS;
  });
  afterEach(() => {
    if (prev === undefined) {
      delete process.env.TRUST_FORWARDED_IPS;
    } else {
      process.env.TRUST_FORWARDED_IPS = prev;
    }
  });

  it("returns null when cf-connecting-ip is missing (CF-only default)", () => {
    const request = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "203.0.113.9",
      },
    });
    delete process.env.TRUST_FORWARDED_IPS;
    expect(getClientIp(request)).toBeNull();
  });

  it("keeps forwarded headers disabled when TRUST_FORWARDED_IPS=false", () => {
    const request = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "203.0.113.9",
      },
    });
    process.env.TRUST_FORWARDED_IPS = "false";
    expect(getClientIp(request)).toBeNull();
  });

  it("ignores cf-connecting-ip unless client ip headers are explicitly trusted", () => {
    const request = new Request("https://example.com", {
      headers: {
        "cf-connecting-ip": "203.0.113.1, 198.51.100.2",
      },
    });
    delete process.env.TRUST_FORWARDED_IPS;
    expect(getClientIp(request)).toBeNull();
  });

  it("returns first ip from cf-connecting-ip when trusted mode is enabled", () => {
    const request = new Request("https://example.com", {
      headers: {
        "cf-connecting-ip": "203.0.113.1, 198.51.100.2",
      },
    });
    process.env.TRUST_FORWARDED_IPS = "true";
    expect(getClientIp(request)).toBe("203.0.113.1");
  });

  it("uses forwarded headers when opt-in enabled", () => {
    const request = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "203.0.113.9, 198.51.100.2",
      },
    });
    process.env.TRUST_FORWARDED_IPS = "true";
    expect(getClientIp(request)).toBe("203.0.113.9");
  });

  it("prefers x-forwarded-for over x-real-ip when trusted mode is enabled", () => {
    const request = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "203.0.113.9, 198.51.100.2",
        "x-real-ip": "198.51.100.77",
      },
    });
    process.env.TRUST_FORWARDED_IPS = "true";
    expect(getClientIp(request)).toBe("203.0.113.9");
  });
});

describe("RATE_LIMITS", () => {
  it("keeps anonymous download bursts installation-friendly", () => {
    expect(RATE_LIMITS.download.ip).toBeGreaterThanOrEqual(1200);
    expect(RATE_LIMITS.download.key).toBeGreaterThanOrEqual(6000);
  });

  it("keeps authenticated write bursts release-friendly", () => {
    expect(RATE_LIMITS.write.ip).toBeGreaterThanOrEqual(300);
    expect(RATE_LIMITS.write.key).toBeGreaterThanOrEqual(3000);
  });

  it("allows trusted publish token mint bursts from shared CI egress", () => {
    expect(RATE_LIMITS.trustedPublish.ip).toBeGreaterThanOrEqual(3000);
    expect(RATE_LIMITS.trustedPublish.key).toBeGreaterThanOrEqual(12000);
  });

  it("gives admin API tokens a larger authenticated bucket", () => {
    expect(RATE_LIMITS.write.adminKey).toBeGreaterThan(RATE_LIMITS.write.key);
    expect(RATE_LIMITS.trustedPublish.adminKey).toBeGreaterThan(RATE_LIMITS.trustedPublish.key);
  });
});

describe("applyRateLimit headers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("returns delay-seconds Retry-After on 429 (not epoch)", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const runMutation = vi.fn();
    const ctx = {
      runQuery: vi.fn().mockResolvedValue({
        allowed: false,
        remaining: 0,
        limit: 20,
        resetAt: 1_030_500,
      }),
      runMutation,
    } as unknown as Parameters<typeof applyRateLimit>[0];
    const request = new Request("https://example.com", {
      headers: { "cf-connecting-ip": "203.0.113.1" },
    });

    const result = await applyRateLimit(ctx, request, "download");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(429);
    expect(result.response.headers.get("Retry-After")).toBe("31");
    expect(result.response.headers.get("X-RateLimit-Reset")).toBe("1031");
    expect(result.response.headers.get("RateLimit-Reset")).toBe("31");
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("includes rate-limit headers without Retry-After when allowed", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000_000);
    const ctx = {
      runQuery: vi.fn().mockResolvedValue({
        allowed: true,
        remaining: 19,
        limit: 20,
        resetAt: 2_015_000,
      }),
      runMutation: vi.fn().mockResolvedValue({
        allowed: true,
        remaining: 18,
      }),
    } as unknown as Parameters<typeof applyRateLimit>[0];
    const request = new Request("https://example.com", {
      headers: { "cf-connecting-ip": "203.0.113.1" },
    });

    const result = await applyRateLimit(ctx, request, "download");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const headers = new Headers(result.headers);
    expect(headers.get("X-RateLimit-Limit")).toBe("20");
    expect(headers.get("X-RateLimit-Remaining")).toBe("18");
    expect(headers.get("X-RateLimit-Reset")).toBe("2015");
    expect(headers.get("RateLimit-Limit")).toBe("20");
    expect(headers.get("RateLimit-Remaining")).toBe("18");
    expect(headers.get("RateLimit-Reset")).toBe("15");
    expect(headers.get("Retry-After")).toBeNull();
  });

  it("retries counter write conflicts before returning headers", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_400_000);
    const runMutation = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          'Document in table "rateLimitCounters" changed while this mutation was being run',
        ),
      )
      .mockResolvedValueOnce({
        allowed: true,
        remaining: 18,
      });
    const ctx = {
      runQuery: vi.fn().mockResolvedValue({
        allowed: true,
        remaining: 19,
        limit: 20,
        resetAt: 2_430_000,
      }),
      runMutation,
    } as unknown as Parameters<typeof applyRateLimit>[0];
    const request = new Request("https://example.com", {
      headers: { "cf-connecting-ip": "203.0.113.1" },
    });

    const result = await applyRateLimit(ctx, request, "download");

    expect(result.ok).toBe(true);
    expect(runMutation).toHaveBeenCalledTimes(2);
    if (!result.ok) return;
    expect(new Headers(result.headers).get("X-RateLimit-Remaining")).toBe("18");
  });

  it("retries another active shard when one partition is full", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_450_000);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const runMutation = vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
      if (args.shard === 0) return { allowed: false, remaining: 0, shardExhausted: true };
      if (args.shard === 1) return { allowed: true, remaining: 18 };
      throw new Error(`Unexpected shard ${String(args.shard)}`);
    });
    const ctx = {
      runQuery: vi.fn().mockResolvedValue({
        allowed: true,
        remaining: 19,
        limit: 20,
        resetAt: 2_480_000,
      }),
      runMutation,
    } as unknown as Parameters<typeof applyRateLimit>[0];
    const request = new Request("https://example.com", {
      headers: { "cf-connecting-ip": "203.0.113.1" },
    });

    const result = await applyRateLimit(ctx, request, "download");

    expect(result.ok).toBe(true);
    expect(
      runMutation.mock.calls.map(([, args]) => (args as Record<string, unknown>).shard),
    ).toEqual([0, 1]);
    if (!result.ok) return;
    expect(new Headers(result.headers).get("X-RateLimit-Remaining")).toBe("18");
  });

  it("returns retryable unavailable response for persistent counter write conflicts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_500_000);
    const ctx = {
      runQuery: vi.fn().mockResolvedValue({
        allowed: true,
        remaining: 19,
        limit: 20,
        resetAt: 2_530_000,
      }),
      runMutation: vi
        .fn()
        .mockRejectedValue(
          new Error(
            'Document in table "rateLimitCounters" changed while this mutation was being run',
          ),
        ),
    } as unknown as Parameters<typeof applyRateLimit>[0];
    const request = new Request("https://example.com", {
      headers: { "cf-connecting-ip": "203.0.113.1" },
    });

    const resultPromise = applyRateLimit(ctx, request, "download");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(503);
    expect(result.response.headers.get("Retry-After")).toBe("1");
    await expect(result.response.text()).resolves.toBe("Rate limit temporarily unavailable");
  });

  it("selects one of 16 active counter shards", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_600_000);
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const ctx = makeRateLimitCtx({
      ip: {
        allowed: true,
        remaining: 19,
        limit: 20,
        resetAt: 2_640_000,
      },
    });
    const request = new Request("https://example.com", {
      headers: { "cf-connecting-ip": "203.0.113.1" },
    });

    const result = await applyRateLimit(ctx, request, "download");

    expect(result.ok).toBe(true);
    const runMutation = (ctx as unknown as { runMutation: ReturnType<typeof vi.fn> }).runMutation;
    const [, args] = runMutation.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(args.shard).toBe(15);
  });

  it("allows authenticated users when user bucket is healthy and shared ip bucket is exhausted", async () => {
    vi.spyOn(Date, "now").mockReturnValue(3_000_000);
    const ctx = makeRateLimitCtx({
      ip: {
        allowed: false,
        remaining: 0,
        limit: 20,
        resetAt: 3_040_000,
      },
      user: {
        allowed: true,
        remaining: 42,
        limit: 120,
        resetAt: 3_010_000,
      },
    });
    const request = new Request("https://example.com", {
      headers: {
        authorization: "Bearer clh_token",
        "cf-connecting-ip": "203.0.113.1",
      },
    });

    const result = await applyRateLimit(ctx, request, "download");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const headers = new Headers(result.headers);
    expect(headers.get("X-RateLimit-Limit")).toBe("120");
    expect(headers.get("X-RateLimit-Remaining")).toBe("41");
    expect(headers.get("Retry-After")).toBeNull();
  });

  it("does not consume ip bucket for authenticated requests", async () => {
    vi.spyOn(Date, "now").mockReturnValue(3_100_000);
    const ctx = makeRateLimitCtx({
      ip: {
        allowed: true,
        remaining: 19,
        limit: 20,
        resetAt: 3_140_000,
      },
      user: {
        allowed: true,
        remaining: 41,
        limit: 120,
        resetAt: 3_110_000,
      },
    });
    const request = new Request("https://example.com", {
      headers: {
        authorization: "Bearer clh_token",
        "cf-connecting-ip": "203.0.113.1",
      },
    });

    const result = await applyRateLimit(ctx, request, "download");
    expect(result.ok).toBe(true);
    const runMutation = (ctx as unknown as { runMutation: ReturnType<typeof vi.fn> }).runMutation;
    const consumedKeys = runMutation.mock.calls.map(([, args]) => String(args.key));
    expect(consumedKeys.some((key) => key.startsWith("user:"))).toBe(true);
    expect(consumedKeys.some((key) => key.startsWith("ip:"))).toBe(false);
  });

  it("uses the admin bucket for authenticated admin requests", async () => {
    vi.spyOn(Date, "now").mockReturnValue(3_200_000);
    const ctx = makeRateLimitCtx({
      userRole: "admin",
      ip: {
        allowed: true,
        remaining: 19,
        limit: RATE_LIMITS.write.ip,
        resetAt: 3_240_000,
      },
      user: {
        allowed: true,
        remaining: RATE_LIMITS.write.adminKey,
        limit: RATE_LIMITS.write.adminKey,
        resetAt: 3_230_000,
      },
    });
    const request = new Request("https://example.com", {
      headers: {
        authorization: "Bearer clh_admin",
        "cf-connecting-ip": "203.0.113.1",
      },
    });

    const result = await applyRateLimit(ctx, request, "write");

    expect(result.ok).toBe(true);
    const runQuery = (ctx as unknown as { runQuery: ReturnType<typeof vi.fn> }).runQuery;
    const rateLimitStatusCalls = runQuery.mock.calls
      .map(([, args]) => args as Record<string, unknown>)
      .filter((args) => "key" in args && "limit" in args);
    expect(rateLimitStatusCalls).toContainEqual(
      expect.objectContaining({
        key: "user:users_123:write",
        limit: RATE_LIMITS.write.adminKey,
      }),
    );
    if (!result.ok) return;
    expect(new Headers(result.headers).get("X-RateLimit-Limit")).toBe(
      String(RATE_LIMITS.write.adminKey),
    );
  });

  it("denies authenticated users when user bucket is exhausted even if ip bucket is healthy", async () => {
    vi.spyOn(Date, "now").mockReturnValue(4_000_000);
    const ctx = makeRateLimitCtx({
      ip: {
        allowed: true,
        remaining: 19,
        limit: 20,
        resetAt: 4_020_000,
      },
      user: {
        allowed: false,
        remaining: 0,
        limit: 120,
        resetAt: 4_030_000,
      },
    });
    const request = new Request("https://example.com", {
      headers: {
        authorization: "Bearer clh_token",
        "cf-connecting-ip": "203.0.113.1",
      },
    });

    const result = await applyRateLimit(ctx, request, "download");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(429);
    expect(result.response.headers.get("X-RateLimit-Limit")).toBe("120");
    expect(result.response.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(result.response.headers.get("Retry-After")).toBe("30");
  });

  it("uses one anonymous download fallback bucket when client ip is missing", async () => {
    vi.spyOn(Date, "now").mockReturnValue(4_500_000);
    const ctx = makeRateLimitCtx({
      ip: {
        allowed: true,
        remaining: 19,
        limit: 20,
        resetAt: 4_530_000,
      },
    });

    await applyRateLimit(
      ctx,
      new Request("https://example.com/api/v1/download?slug=first&version=1.0.0"),
      "download",
    );
    await applyRateLimit(
      ctx,
      new Request("https://example.com/api/v1/packages/second-plugin/download?version=0.2.0"),
      "download",
    );

    const runMutation = (ctx as unknown as { runMutation: ReturnType<typeof vi.fn> }).runMutation;
    expect(runMutation.mock.calls.map(([, args]) => String(args.key))).toEqual([
      "ip:unknown:download",
      "ip:unknown:download",
    ]);
  });

  it("scopes known-ip anonymous buckets by rate limit kind", async () => {
    vi.stubEnv("TRUST_FORWARDED_IPS", "true");
    vi.spyOn(Date, "now").mockReturnValue(4_550_000);
    const readCtx = makeRateLimitCtx({
      ip: {
        allowed: true,
        remaining: 19,
        limit: RATE_LIMITS.read.ip,
        resetAt: 4_580_000,
      },
    });
    const downloadCtx = makeRateLimitCtx({
      ip: {
        allowed: true,
        remaining: 19,
        limit: RATE_LIMITS.download.ip,
        resetAt: 4_580_000,
      },
    });
    const request = new Request("https://example.com/api/v1/packages/demo/download", {
      headers: { "cf-connecting-ip": "203.0.113.1" },
    });

    await applyRateLimit(readCtx, request, "read");
    await applyRateLimit(downloadCtx, request, "download");

    const readMutation = (readCtx as unknown as { runMutation: ReturnType<typeof vi.fn> })
      .runMutation;
    const downloadMutation = (downloadCtx as unknown as { runMutation: ReturnType<typeof vi.fn> })
      .runMutation;
    expect(readMutation.mock.calls.map(([, args]) => String(args.key))).toContain(
      "ip:203.0.113.1:read",
    );
    expect(downloadMutation.mock.calls.map(([, args]) => String(args.key))).toContain(
      "ip:203.0.113.1:download",
    );
  });

  it("scopes authenticated buckets by rate limit kind", async () => {
    vi.spyOn(Date, "now").mockReturnValue(4_575_000);
    const ctx = makeRateLimitCtx({
      ip: {
        allowed: true,
        remaining: 19,
        limit: RATE_LIMITS.read.ip,
        resetAt: 4_600_000,
      },
      user: {
        allowed: true,
        remaining: 42,
        limit: RATE_LIMITS.download.key,
        resetAt: 4_600_000,
      },
    });
    const request = new Request("https://example.com/api/v1/packages/demo/download", {
      headers: {
        authorization: "Bearer clh_token",
        "cf-connecting-ip": "203.0.113.1",
      },
    });

    const result = await applyRateLimit(ctx, request, "download");

    expect(result.ok).toBe(true);
    const runMutation = (ctx as unknown as { runMutation: ReturnType<typeof vi.fn> }).runMutation;
    expect(runMutation.mock.calls.map(([, args]) => String(args.key))).toContain(
      "user:users_123:download",
    );
  });

  it("uses one anonymous read fallback bucket when client ip is missing", async () => {
    vi.spyOn(Date, "now").mockReturnValue(4_600_000);
    const ctx = makeRateLimitCtx({
      ip: {
        allowed: true,
        remaining: 19,
        limit: 20,
        resetAt: 4_630_000,
      },
    });

    await applyRateLimit(ctx, new Request("https://example.com/api/v1/search?q=demo"), "read");
    await applyRateLimit(
      ctx,
      new Request("https://example.com/api/v1/packages/second-plugin"),
      "read",
    );

    const runMutation = (ctx as unknown as { runMutation: ReturnType<typeof vi.fn> }).runMutation;
    expect(runMutation.mock.calls.map(([, args]) => String(args.key))).toEqual([
      "ip:unknown:read",
      "ip:unknown:read",
    ]);
  });

  it("falls back to ip enforcement when bearer token is invalid", async () => {
    vi.spyOn(Date, "now").mockReturnValue(5_000_000);
    const ctx = makeRateLimitCtx({
      tokenValid: false,
      ip: {
        allowed: false,
        remaining: 0,
        limit: 20,
        resetAt: 5_030_000,
      },
    });
    const request = new Request("https://example.com", {
      headers: {
        authorization: "Bearer invalid",
        "cf-connecting-ip": "203.0.113.1",
      },
    });

    const result = await applyRateLimit(ctx, request, "download");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(429);
    expect(result.response.headers.get("X-RateLimit-Limit")).toBe("20");
    expect(result.response.headers.get("Retry-After")).toBe("30");
  });
});
