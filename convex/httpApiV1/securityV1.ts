import {
  ApiV1SecurityRescanResponseSchema,
  ApiV1SecurityScanSummaryResponseSchema,
  parseArk,
} from "clawhub-schema";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { applyRateLimit } from "../lib/httpRateLimit";
import {
  formatAuthzMessage,
  getPathSegments,
  json,
  requireApiTokenUserOrResponse,
  text,
} from "./shared";

const internalRefs = internal as unknown as {
  securityScans: {
    getSecurityScanSummaryForStaffInternal: unknown;
    requestSkillSecurityRescanForStaffInternal: unknown;
    requestPluginSecurityRescanForStaffInternal: unknown;
  };
};

async function runQueryRef<T>(ctx: ActionCtx, ref: unknown, args: unknown): Promise<T> {
  return (await ctx.runQuery(ref as never, args as never)) as T;
}

async function runMutationRef<T>(ctx: ActionCtx, ref: unknown, args: unknown): Promise<T> {
  return (await ctx.runMutation(ref as never, args as never)) as T;
}

function securityErrorToResponse(
  error: unknown,
  fallback: "Security summary failed" | "Security rescan failed",
  headers: HeadersInit,
) {
  const message = error instanceof Error ? error.message : fallback;
  const lower = message.toLowerCase();
  if (lower.includes("unauthorized")) {
    return text(formatAuthzMessage(error, "Unauthorized"), 401, headers);
  }
  if (lower.includes("forbidden")) {
    return text(formatAuthzMessage(error, "Forbidden"), 403, headers);
  }
  return text(message, 400, headers);
}

async function parseOptionalJsonObject(request: Request, headers: HeadersInit) {
  const raw = await request.text();
  if (!raw.trim()) return { ok: true as const, payload: {} as Record<string, unknown> };
  try {
    const payload = JSON.parse(raw) as unknown;
    return {
      ok: true as const,
      payload:
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : {},
    };
  } catch {
    return { ok: false as const, response: text("Invalid JSON", 400, headers) };
  }
}

export async function securityGetRouterV1Handler(ctx: ActionCtx, request: Request) {
  const segments = getPathSegments(request, "/api/v1/security/");
  if (segments[0] !== "summary" || segments.length !== 1) return text("Not found", 404);
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;
  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;
  try {
    const result = await runQueryRef(
      ctx,
      internalRefs.securityScans.getSecurityScanSummaryForStaffInternal,
      { actorUserId: auth.userId },
    );
    const parsed = parseArk(
      ApiV1SecurityScanSummaryResponseSchema,
      result,
      "Security scan summary response",
    );
    return json(parsed, 200, rate.headers);
  } catch (error) {
    return securityErrorToResponse(error, "Security summary failed", rate.headers);
  }
}

export async function securityPostRouterV1Handler(ctx: ActionCtx, request: Request) {
  const segments = getPathSegments(request, "/api/v1/security/");
  const rate = await applyRateLimit(ctx, request, "write");
  if (!rate.ok) return rate.response;
  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;
  try {
    let result: unknown;
    if (
      segments[0] === "skills" &&
      segments[1] &&
      segments[2] === "rescan" &&
      segments.length === 3
    ) {
      result = await runMutationRef(
        ctx,
        internalRefs.securityScans.requestSkillSecurityRescanForStaffInternal,
        { actorUserId: auth.userId, slug: segments[1] },
      );
    } else if (
      segments[0] === "plugins" &&
      segments[1] &&
      segments[2] === "rescan" &&
      segments.length === 3
    ) {
      const parsedBody = await parseOptionalJsonObject(request, rate.headers);
      if (!parsedBody.ok) return parsedBody.response;
      const body = parsedBody.payload;
      const version = typeof body.version === "string" ? body.version : undefined;
      result = await runMutationRef(
        ctx,
        internalRefs.securityScans.requestPluginSecurityRescanForStaffInternal,
        { actorUserId: auth.userId, name: segments[1], version },
      );
    } else {
      return text("Not found", 404, rate.headers);
    }
    const parsed = parseArk(ApiV1SecurityRescanResponseSchema, result, "Security rescan response");
    return json(parsed, 200, rate.headers);
  } catch (error) {
    return securityErrorToResponse(error, "Security rescan failed", rate.headers);
  }
}
