import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { getOptionalActiveAuthUserIdFromAction } from "./access";
import { hashToken } from "./tokens";

type TokenAuthResult = { user: Doc<"users">; userId: Doc<"users">["_id"] };
type ApiTokenAuthResult = TokenAuthResult & { apiToken: ApiTokenDoc };
type ApiTokenDoc = Doc<"apiTokens">;
type PackagePublishTokenAuthResult = {
  kind: "github-actions";
  publishToken: Doc<"packagePublishTokens">;
};
type UserPackagePublishAuthResult = {
  kind: "user";
  user: Doc<"users">;
  userId: Doc<"users">["_id"];
};

export const MISSING_API_TOKEN_MESSAGE =
  "Unauthorized: API token is missing. Run `clawhub login` to authenticate.";
export const INVALID_API_TOKEN_MESSAGE =
  "Unauthorized: API token is invalid or revoked. Run `clawhub login` again.";
export const BLOCKED_API_TOKEN_ACCOUNT_MESSAGE =
  "Unauthorized: This ClawHub account is not in good standing and cannot use API tokens. If you believe this is a mistake, contact security@openclaw.ai.";

export async function requireApiTokenUser(
  ctx: ActionCtx,
  request: Request,
): Promise<TokenAuthResult> {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  const token = parseBearerToken(header);
  if (!token) throw new ConvexError(MISSING_API_TOKEN_MESSAGE);

  const tokenHash = await hashToken(token);
  const apiToken = await ctx.runQuery(internal.tokens.getByHashInternal, { tokenHash });
  if (!apiToken || apiToken.revokedAt) throw new ConvexError(INVALID_API_TOKEN_MESSAGE);

  const user = await ctx.runQuery(internal.tokens.getUserForTokenInternal, {
    tokenId: apiToken._id,
  });
  if (!user || user.deletedAt || user.deactivatedAt) {
    throw new ConvexError(BLOCKED_API_TOKEN_ACCOUNT_MESSAGE);
  }

  try {
    await ctx.runMutation(internal.tokens.touchInternal, { tokenId: apiToken._id });
  } catch {
    // Best-effort metadata; auth succeeded and should not fail on write contention.
  }
  return { user, userId: user._id };
}

export async function getOptionalApiTokenUserId(
  ctx: ActionCtx,
  request: Request,
): Promise<Doc<"users">["_id"] | null> {
  return (await getOptionalApiTokenUser(ctx, request))?.userId ?? null;
}

export async function getOptionalApiTokenUser(
  ctx: ActionCtx,
  request: Request,
): Promise<TokenAuthResult | null> {
  const auth = await getOptionalApiTokenAuth(ctx, request);
  return auth ? { user: auth.user, userId: auth.userId } : null;
}

async function getOptionalApiTokenAuth(
  ctx: ActionCtx,
  request: Request,
): Promise<ApiTokenAuthResult | null> {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  const token = parseBearerToken(header);
  if (!token) return null;

  const tokenHash = await hashToken(token);
  const apiToken = await ctx.runQuery(internal.tokens.getByHashInternal, { tokenHash });
  if (!apiToken || apiToken.revokedAt) return null;

  const user = await ctx.runQuery(internal.tokens.getUserForTokenInternal, {
    tokenId: apiToken._id,
  });
  if (!user || user.deletedAt || user.deactivatedAt) return null;

  return { user, userId: user._id, apiToken };
}

export async function requirePackagePublishAuth(
  ctx: ActionCtx,
  request: Request,
): Promise<UserPackagePublishAuthResult | PackagePublishTokenAuthResult> {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  const token = parseBearerToken(header);
  if (token) {
    const tokenHash = await hashToken(token);
    const publishToken = await ctx.runQuery(internal.packagePublishTokens.getByHashInternal, {
      tokenHash,
    });
    if (publishToken && !publishToken.revokedAt && publishToken.expiresAt > Date.now()) {
      try {
        await ctx.runMutation(internal.packagePublishTokens.touchInternal, {
          tokenId: publishToken._id,
        });
      } catch {
        // Best-effort metadata; publish auth should not fail on touch contention.
      }
      return { kind: "github-actions", publishToken };
    }

    const apiTokenAuth = await getOptionalApiTokenAuth(ctx, request);
    if (apiTokenAuth) {
      try {
        await ctx.runMutation(internal.tokens.touchInternal, {
          tokenId: apiTokenAuth.apiToken._id,
        });
      } catch {
        // Best-effort metadata; publish auth should not fail on touch contention.
      }
      return { kind: "user", user: apiTokenAuth.user, userId: apiTokenAuth.userId };
    }
  }

  const sessionUserId = await getOptionalActiveAuthUserIdFromAction(ctx);
  if (sessionUserId) {
    const user = await ctx.runQuery(internal.users.getByIdInternal, { userId: sessionUserId });
    if (!user || user.deletedAt || user.deactivatedAt) {
      throw new ConvexError(BLOCKED_API_TOKEN_ACCOUNT_MESSAGE);
    }
    return { kind: "user", user, userId: user._id };
  }

  throw new ConvexError(token ? INVALID_API_TOKEN_MESSAGE : MISSING_API_TOKEN_MESSAGE);
}

export function parseBearerToken(header: string | null) {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token || null;
}
