import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { getOptionalApiTokenUser } from "./apiTokenAuth";
import { corsHeaders, mergeHeaders } from "./httpHeaders";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_SHARDS = 64;
export const RATE_LIMITS = {
  read: { ip: 3000, key: 12000, adminKey: 120000 },
  write: { ip: 300, key: 3000, adminKey: 30000 },
  trustedPublish: { ip: 3000, key: 12000, adminKey: 120000 },
  download: { ip: 1200, key: 6000, adminKey: 60000 },
  export: { ip: 10, key: 60, adminKey: 60 },
} as const;

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
};

type UserRateLimitAuth = {
  kind?: "user";
  userId: string;
  user: Pick<Doc<"users">, "role">;
};

type TrustedPublishRateLimitAuth = {
  kind: "trusted-publish";
  publishTokenId: string;
};

type RateLimitAuth = UserRateLimitAuth | TrustedPublishRateLimitAuth;

export async function rejectIfMissingAuthAnonymousRateLimited(
  ctx: ActionCtx,
  request: Request,
  kind: keyof typeof RATE_LIMITS,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  if (parseBearerToken(request)) return { ok: true };

  const ip = getClientIp(request) ?? "unknown";
  const status = await getRateLimitStatus(
    ctx,
    getAnonymousRateLimitKey(request, kind, ip),
    RATE_LIMITS[kind].ip,
  );
  if (status.allowed) return { ok: true };

  console.info("rate_limit_denied", {
    kind,
    auth: false,
    preAuth: true,
    userAllowed: null,
    ipAllowed: false,
    ipSource: getClientIpSource(request),
    hasClientIp: ip !== "unknown",
  });
  return { ok: false, response: rateLimitResponse(status) };
}

export async function applyRateLimit(
  ctx: ActionCtx,
  request: Request,
  kind: keyof typeof RATE_LIMITS,
  options: { auth?: RateLimitAuth | null } = {},
): Promise<{ ok: true; headers: HeadersInit } | { ok: false; response: Response }> {
  const auth =
    options.auth === undefined ? await getOptionalApiTokenUser(ctx, request) : options.auth;
  const ip = getClientIp(request) ?? "unknown";
  const ipSource = getClientIpSource(request);
  const hasClientIp = ip !== "unknown";

  // Authenticated requests are enforced and consumed by user bucket only to
  // avoid draining shared IP quota.
  if (auth) {
    const userLimit = getAuthenticatedRateLimit(kind, auth);
    const userResult = await checkRateLimit(
      ctx,
      getAuthenticatedRateLimitKey(auth, kind),
      userLimit,
    );
    const headers = rateHeaders(userResult);
    if (!userResult.allowed) {
      console.info("rate_limit_denied", {
        kind,
        auth: true,
        admin: isAdminRateLimitAuth(auth),
        userAllowed: false,
        ipAllowed: null,
        ipSource,
        hasClientIp,
      });
      return {
        ok: false,
        response: rateLimitResponse(userResult),
      };
    }
    return { ok: true, headers };
  }

  // Anonymous requests remain IP-enforced.
  const ipResult = await checkRateLimit(
    ctx,
    getAnonymousRateLimitKey(request, kind, ip),
    RATE_LIMITS[kind].ip,
  );
  const headers = rateHeaders(ipResult);

  if (!ipResult.allowed) {
    console.info("rate_limit_denied", {
      kind,
      auth: false,
      userAllowed: null,
      ipAllowed: ipResult.allowed,
      ipSource,
      hasClientIp,
    });
    return {
      ok: false,
      response: rateLimitResponse(ipResult),
    };
  }

  return { ok: true, headers };
}

function getAnonymousRateLimitKey(request: Request, kind: keyof typeof RATE_LIMITS, ip: string) {
  if (ip !== "unknown") return `ip:${ip}:${kind}`;
  if (kind !== "download") return `ip:unknown:${kind}`;
  return `ip:unknown:download:${getDownloadRateLimitScope(request)}`;
}

function getAuthenticatedRateLimitKey(auth: RateLimitAuth, kind: keyof typeof RATE_LIMITS) {
  if (auth.kind === "trusted-publish") return `trusted-publish:${auth.publishTokenId}:${kind}`;
  return `user:${auth.userId}:${kind}`;
}

function getAuthenticatedRateLimit(kind: keyof typeof RATE_LIMITS, auth: RateLimitAuth) {
  return isAdminRateLimitAuth(auth) ? RATE_LIMITS[kind].adminKey : RATE_LIMITS[kind].key;
}

function isAdminRateLimitAuth(auth: RateLimitAuth) {
  return auth.kind !== "trusted-publish" && auth.user.role === "admin";
}

export function getClientIp(request: Request) {
  const cfHeader = request.headers.get("cf-connecting-ip");
  if (cfHeader) return splitFirstIp(cfHeader);

  if (!shouldTrustForwardedIps()) return null;

  const forwarded =
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("fly-client-ip");

  return splitFirstIp(forwarded);
}

function getClientIpSource(request: Request) {
  if (request.headers.get("cf-connecting-ip")) return "cf-connecting-ip";
  if (!shouldTrustForwardedIps()) return "none";
  if (request.headers.get("x-forwarded-for")) return "x-forwarded-for";
  if (request.headers.get("x-real-ip")) return "x-real-ip";
  if (request.headers.get("fly-client-ip")) return "fly-client-ip";
  return "none";
}

async function checkRateLimit(
  ctx: ActionCtx,
  key: string,
  limit: number,
): Promise<RateLimitResult> {
  // Step 1: Read-only check to avoid write conflicts on denied requests.
  const status = await getRateLimitStatus(ctx, key, limit);

  if (!status.allowed) {
    return status;
  }

  // Step 2: Consume with a mutation only when still allowed.
  let result: { allowed: boolean; remaining: number };
  try {
    result = (await ctx.runMutation(internal.rateLimits.consumeRateLimitInternal, {
      key,
      limit,
      windowMs: RATE_LIMIT_WINDOW_MS,
      shard: Math.floor(Math.random() * RATE_LIMIT_SHARDS),
    })) as { allowed: boolean; remaining: number };
  } catch (error) {
    if (isRateLimitWriteConflict(error)) {
      return {
        allowed: false,
        remaining: 0,
        limit: status.limit,
        resetAt: status.resetAt,
      };
    }
    throw error;
  }

  return {
    allowed: result.allowed,
    remaining: Math.max(0, status.remaining - 1),
    limit: status.limit,
    resetAt: status.resetAt,
  };
}

async function getRateLimitStatus(
  ctx: ActionCtx,
  key: string,
  limit: number,
): Promise<RateLimitResult> {
  return (await ctx.runQuery(internal.rateLimits.getRateLimitStatusInternal, {
    key,
    limit,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })) as RateLimitResult;
}

function rateLimitResponse(result: RateLimitResult) {
  return new Response("Rate limit exceeded", {
    status: 429,
    headers: mergeHeaders(
      {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
      rateHeaders(result),
      corsHeaders(),
    ),
  });
}

function rateHeaders(result: RateLimitResult): HeadersInit {
  const nowMs = Date.now();
  const resetSeconds = Math.ceil(result.resetAt / 1000);
  const resetDelaySeconds = Math.max(1, Math.ceil((result.resetAt - nowMs) / 1000));
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(resetSeconds),
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(resetDelaySeconds),
    ...(result.allowed ? {} : { "Retry-After": String(resetDelaySeconds) }),
  };
}

export function parseBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token || null;
}

function splitFirstIp(header: string | null) {
  if (!header) return null;
  if (header.includes(",")) return header.split(",")[0]?.trim() || null;
  const trimmed = header.trim();
  return trimmed || null;
}

function getDownloadRateLimitScope(request: Request) {
  try {
    const url = new URL(request.url);
    const path = normalizeRateLimitKeyPart(url.pathname.replace(/\/{2,}/g, "/") || "/");
    const params = new URLSearchParams();

    for (const name of ["slug", "version", "tag"] as const) {
      const value = url.searchParams.get(name)?.trim();
      if (value) params.set(name, normalizeRateLimitKeyPart(value));
    }

    const query = params.toString();
    return query ? `${path}?${query}` : path;
  } catch {
    return "unknown";
  }
}

function normalizeRateLimitKeyPart(value: string) {
  return value.slice(0, 500);
}

function shouldTrustForwardedIps() {
  const value = (process.env.TRUST_FORWARDED_IPS ?? "").trim().toLowerCase();
  // Hardening default: CF-only. Forwarded headers are trivial to spoof unless you
  // control the trusted proxy layer.
  if (!value) return false;
  if (value === "1" || value === "true" || value === "yes") return true;
  return false;
}

function isRateLimitWriteConflict(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    (error.message.includes("rateLimits") || error.message.includes("rateLimitShards")) &&
    error.message.includes("changed while this mutation was being run")
  );
}
