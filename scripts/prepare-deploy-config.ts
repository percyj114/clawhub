#!/usr/bin/env bun

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type DeployConfigTarget = "production" | "staging";

export type PrepareDeployConfigOptions = {
  rootDir: string;
  target: DeployConfigTarget;
  siteUrl: string;
  convexSiteUrl: string;
  minCliVersion: string;
  dryRun?: boolean;
};

const DEFAULT_PRODUCTION_SITE_URL = "https://clawhub.ai";
const DEFAULT_PRODUCTION_CONVEX_SITE_URL = "https://wry-manatee-359.convex.site";
const DEFAULT_STAGING_SITE_URL = "https://staging.hub.openclaw.ai";
const DEFAULT_MIN_CLI_VERSION = "0.1.0";

function readString(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeOrigin(value: string, name: string) {
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`${name} must be an absolute URL; received ${JSON.stringify(value)}.`);
  }
}

function parseTarget(value: string | undefined): DeployConfigTarget {
  if (!value || value === "production") return "production";
  if (value === "staging") return "staging";
  throw new Error(
    `Unsupported deploy target ${JSON.stringify(value)}. Expected production or staging.`,
  );
}

export function renderWellKnownConfig(options: { siteUrl: string; minCliVersion: string }) {
  const siteUrl = normalizeOrigin(options.siteUrl, "siteUrl");
  return `${JSON.stringify(
    {
      apiBase: siteUrl,
      authBase: siteUrl,
      minCliVersion: options.minCliVersion,
      registry: siteUrl,
    },
    null,
    2,
  )}\n`;
}

export function renderRobotsTxt(target: DeployConfigTarget) {
  if (target === "staging") {
    return "# Staging environment\nUser-agent: *\nDisallow: /\n";
  }
  return "# https://www.robotstxt.org/robotstxt.html\nUser-agent: *\nDisallow:\n";
}

export function rewriteVercelJson(content: string, convexSiteUrl: string) {
  const parsed = JSON.parse(content) as {
    rewrites?: Array<Record<string, unknown>>;
  };
  const rewrites = Array.isArray(parsed.rewrites) ? parsed.rewrites : [];
  const convexOrigin = normalizeOrigin(convexSiteUrl, "convexSiteUrl");
  let foundApiRewrite = false;

  parsed.rewrites = rewrites.map((rewrite) => {
    if (rewrite.source !== "/api/:path*") return rewrite;
    foundApiRewrite = true;
    return {
      ...rewrite,
      destination: `${convexOrigin}/api/:path*`,
    };
  });

  if (!foundApiRewrite) {
    parsed.rewrites.push({
      source: "/api/:path*",
      destination: `${convexOrigin}/api/:path*`,
    });
  }

  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function writeMaybe(path: string, content: string, dryRun: boolean) {
  if (dryRun) {
    console.log(`[dry-run] would write ${path}`);
    return;
  }
  writeFileSync(path, content);
  console.log(`Wrote ${path}`);
}

export function prepareDeployConfig(options: PrepareDeployConfigOptions) {
  const siteUrl = normalizeOrigin(options.siteUrl, "siteUrl");
  const convexSiteUrl = normalizeOrigin(options.convexSiteUrl, "convexSiteUrl");
  const dryRun = options.dryRun ?? false;

  const vercelJsonPath = join(options.rootDir, "vercel.json");
  const wellKnownPath = join(options.rootDir, "public", ".well-known", "clawhub.json");
  const legacyWellKnownPath = join(options.rootDir, "public", ".well-known", "clawdhub.json");
  const robotsPath = join(options.rootDir, "public", "robots.txt");

  if (!existsSync(vercelJsonPath)) {
    throw new Error(`Missing ${vercelJsonPath}`);
  }

  const wellKnown = renderWellKnownConfig({
    siteUrl,
    minCliVersion: options.minCliVersion,
  });

  writeMaybe(
    vercelJsonPath,
    rewriteVercelJson(readFileSync(vercelJsonPath, "utf8"), convexSiteUrl),
    dryRun,
  );
  writeMaybe(wellKnownPath, wellKnown, dryRun);
  writeMaybe(legacyWellKnownPath, wellKnown, dryRun);
  writeMaybe(robotsPath, renderRobotsTxt(options.target), dryRun);
}

function parseCliArgs(argv: string[]) {
  const values: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      values.dryRun = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument ${JSON.stringify(arg)}`);
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    values[key] = next;
    index += 1;
  }
  return values;
}

function readOptionValue(values: Record<string, string | boolean>, key: string) {
  return typeof values[key] === "string" ? values[key] : undefined;
}

export function resolvePrepareDeployConfigOptions(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): PrepareDeployConfigOptions {
  const values = parseCliArgs(argv);
  const target = parseTarget(
    readOptionValue(values, "target") ?? readString(env.DEPLOY_TARGET) ?? "production",
  );
  const siteUrl =
    readOptionValue(values, "site-url") ??
    readString(env.STAGING_SITE_URL) ??
    readString(env.SITE_URL) ??
    readString(env.VITE_SITE_URL) ??
    (target === "staging" ? DEFAULT_STAGING_SITE_URL : DEFAULT_PRODUCTION_SITE_URL);
  const convexSiteUrl =
    readOptionValue(values, "convex-site-url") ??
    readString(env.STAGING_CONVEX_SITE_URL) ??
    readString(env.VITE_CONVEX_SITE_URL) ??
    (target === "production" ? DEFAULT_PRODUCTION_CONVEX_SITE_URL : undefined);

  if (!convexSiteUrl) {
    throw new Error(
      "Missing staging Convex site URL. Pass --convex-site-url or set STAGING_CONVEX_SITE_URL.",
    );
  }

  return {
    rootDir: readOptionValue(values, "root") ?? process.cwd(),
    target,
    siteUrl,
    convexSiteUrl,
    minCliVersion:
      readOptionValue(values, "min-cli-version") ??
      readString(env.CLAWHUB_MIN_CLI_VERSION) ??
      DEFAULT_MIN_CLI_VERSION,
    dryRun: values.dryRun === true,
  };
}

if (import.meta.main) {
  prepareDeployConfig(resolvePrepareDeployConfigOptions(process.argv.slice(2)));
}
