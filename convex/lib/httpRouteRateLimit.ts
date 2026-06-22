import { ApiRoutes, LegacyApiRoutes } from "clawhub-schema";
import type { HttpRouter, PublicHttpAction, RouteSpec } from "convex/server";
import type { ActionCtx } from "../_generated/server";
import { httpAction } from "../functions";
import { mergeHeaders } from "./httpHeaders";
import { applyRateLimit, markRateLimitApplied, RATE_LIMITS } from "./httpRateLimit";

type HttpHandler = (ctx: ActionCtx, request: Request) => Promise<Response>;

type RegisteredHttpAction = PublicHttpAction & {
  _handler?: HttpHandler;
};

type RouteRateLimitKind = keyof typeof RATE_LIMITS;
type RouteRateLimitDecision = { kind: "none" } | { kind: RouteRateLimitKind };

type RateLimitedHttpActionOptions = {
  resolveRateLimit: (request: Request) => RouteRateLimitDecision;
};

type RouteRateLimitResolver = (spec: RouteSpec, request: Request) => RouteRateLimitDecision;

type InstallRateLimitedRoutesOptions = {
  resolveRateLimit?: RouteRateLimitResolver;
};

const authMetadataPaths = new Set(["/.well-known/openid-configuration", "/.well-known/jwks.json"]);

export function installRateLimitedRoutes(
  http: HttpRouter,
  options: InstallRateLimitedRoutesOptions = {},
): HttpRouter {
  const route = http.route.bind(http);

  // Convex has no HTTP middleware hook, so install one wrapper at registration time.
  http.route = ((spec: RouteSpec) => {
    route({
      ...spec,
      handler: rateLimitedHttpAction(spec.handler, {
        resolveRateLimit: (request) =>
          options.resolveRateLimit?.(spec, request) ?? resolveDefaultRouteRateLimit(spec, request),
      }),
    });
  }) as typeof http.route;

  return http;
}

function resolveDefaultRouteRateLimit(spec: RouteSpec, request: Request): RouteRateLimitDecision {
  if (spec.method === "OPTIONS") return { kind: "none" };

  const routedPath = getRoutedPath(spec);
  if (authMetadataPaths.has(routedPath)) return { kind: "none" };

  if (routedPath === ApiRoutes.publishTokenMint) return { kind: "trustedPublish" };
  if (routedPath === ApiRoutes.skillsExport || routedPath === ApiRoutes.pluginsExport) {
    return { kind: "export" };
  }

  if (spec.method === "GET") {
    if (routedPath === ApiRoutes.download || routedPath === LegacyApiRoutes.download) {
      return { kind: "download" };
    }
    if (routedPath === "/api/v1/package-inspector/artifact") return { kind: "download" };
    if ("pathPrefix" in spec && spec.pathPrefix === `${ApiRoutes.packages}/`) {
      return packageReadRouteRateLimitKind(request);
    }
    if ("pathPrefix" in spec && spec.pathPrefix === "/api/npm/") {
      return npmMirrorRouteRateLimitKind(request);
    }
  }

  if (spec.method === "POST" && routedPath === `${ApiRoutes.skills}/-/security-verdicts`) {
    return { kind: "read" };
  }

  return defaultRouteRateLimitKind(spec.method);
}

function defaultRouteRateLimitKind(method: RouteSpec["method"]): RouteRateLimitDecision {
  if (method === "GET") return { kind: "read" };
  if (method === "OPTIONS") return { kind: "none" };
  return { kind: "write" };
}

export function rateLimitedHttpAction(
  action: RegisteredHttpAction,
  options: RateLimitedHttpActionOptions,
): PublicHttpAction {
  const handler = getRegisteredHttpHandler(action);
  return httpAction(async (ctx, request) => {
    const decision = options.resolveRateLimit(request);

    if (decision.kind === "none") {
      return await handler(ctx, request);
    }

    const rate = await applyRateLimit(ctx, request, decision.kind);
    if (!rate.ok) return rate.response;
    markRateLimitApplied(request, rate.headers);

    const response = await handler(ctx, request);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: mergeHeaders(rate.headers, response.headers),
    });
  });
}

function getRegisteredHttpHandler(action: RegisteredHttpAction): HttpHandler {
  if (typeof action._handler !== "function") {
    throw new Error("HTTP action is missing its registered handler");
  }
  return action._handler;
}

function getRoutedPath(spec: RouteSpec): string {
  return "path" in spec ? spec.path : spec.pathPrefix;
}

function packageReadRouteRateLimitKind(request: Request): RouteRateLimitDecision {
  const path = new URL(request.url).pathname;
  if (
    path.endsWith("/download") ||
    path.endsWith("/artifact") ||
    path.endsWith("/artifact/download")
  ) {
    return { kind: "download" };
  }
  return { kind: "read" };
}

function npmMirrorRouteRateLimitKind(request: Request): RouteRateLimitDecision {
  return new URL(request.url).pathname.includes("/-/") ? { kind: "download" } : { kind: "read" };
}
