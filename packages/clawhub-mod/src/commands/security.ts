import { requireAuthToken } from "../../../clawhub/src/cli/authToken.js";
import { getRegistry } from "../../../clawhub/src/cli/registry.js";
import type { GlobalOpts } from "../../../clawhub/src/cli/types.js";
import {
  createSpinner,
  fail,
  formatError,
  isInteractive,
  promptConfirm,
} from "../../../clawhub/src/cli/ui.js";
import { apiRequest } from "../../../clawhub/src/http.js";
import {
  ApiRoutes,
  ApiV1SecurityRescanResponseSchema,
  ApiV1SecurityScanSummaryResponseSchema,
  parseArk,
  type ApiV1SecurityScanSummaryResponse,
} from "../../../clawhub/src/schema/index.js";

type SecuritySummaryOptions = {
  json?: boolean;
};

type SecurityRescanOptions = {
  version?: string;
  yes?: boolean;
  json?: boolean;
};

export async function cmdSecuritySummary(opts: GlobalOpts, options: SecuritySummaryOptions = {}) {
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const result = await apiRequest(
    registry,
    {
      method: "GET",
      path: `${ApiRoutes.security}/summary`,
      token,
    },
    ApiV1SecurityScanSummaryResponseSchema,
  );
  const parsed = parseArk(
    ApiV1SecurityScanSummaryResponseSchema,
    result,
    "Security scan summary response",
  );
  if (options.json) {
    process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
    return parsed;
  }
  printSecuritySummary(parsed);
  return parsed;
}

export async function cmdSkillSecurityRescan(
  opts: GlobalOpts,
  slug: string,
  options: SecurityRescanOptions = {},
  inputAllowed = true,
) {
  const trimmed = slug.trim();
  if (!trimmed) fail("Skill slug required");
  await confirmRescan(`skill ${trimmed}`, options, inputAllowed);
  return await postSecurityRescan(opts, {
    path: `${ApiRoutes.security}/skills/${encodeURIComponent(trimmed)}/rescan`,
    label: trimmed,
    options,
  });
}

export async function cmdPluginSecurityRescan(
  opts: GlobalOpts,
  name: string,
  options: SecurityRescanOptions = {},
  inputAllowed = true,
) {
  const trimmed = name.trim();
  if (!trimmed) fail("Plugin package name required");
  await confirmRescan(`plugin ${trimmed}`, options, inputAllowed);
  return await postSecurityRescan(opts, {
    path: `${ApiRoutes.security}/plugins/${encodeURIComponent(trimmed)}/rescan`,
    label: options.version?.trim() ? `${trimmed}@${options.version.trim()}` : trimmed,
    body: options.version?.trim() ? { version: options.version.trim() } : undefined,
    options,
  });
}

async function postSecurityRescan(
  opts: GlobalOpts,
  params: {
    path: string;
    label: string;
    body?: { version: string };
    options: SecurityRescanOptions;
  },
) {
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = params.options.json
    ? null
    : createSpinner(`Requesting rescan for ${params.label}`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: params.path,
        token,
        ...(params.body ? { body: params.body } : {}),
      },
      ApiV1SecurityRescanResponseSchema,
    );
    const parsed = parseArk(ApiV1SecurityRescanResponseSchema, result, "Security rescan response");
    spinner?.stop();
    if (params.options.json) {
      process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
      return parsed;
    }
    if (parsed.state === "already_in_progress") {
      console.log(
        `Rescan already in progress for ${parsed.target}${formatVersion(parsed.version)}.`,
      );
    } else if (parsed.state === "queued") {
      console.log(
        `Queued ${parsed.scheduledScanners.join(", ")} rescan for ${parsed.target}${formatVersion(parsed.version)}.`,
      );
    } else {
      console.log(`Rescan not queued for ${parsed.target}: ${parsed.state}.`);
    }
    return parsed;
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}

async function confirmRescan(label: string, options: SecurityRescanOptions, inputAllowed: boolean) {
  if (options.yes) return;
  if (!isInteractive() || inputAllowed === false) fail("Pass --yes (no input)");
  const ok = await promptConfirm(`Request security rescan for ${label}?`);
  if (!ok) fail("Cancelled");
}

function printSecuritySummary(summary: ApiV1SecurityScanSummaryResponse) {
  console.log("Security scan summary");
  printCounts("skills", summary.totals.skills);
  printCounts("plugins", summary.totals.plugins);
  if (summary.stale) {
    console.log("Rollups need rebuild before counts are complete.");
  }
}

function printCounts(label: string, counts: ApiV1SecurityScanSummaryResponse["totals"]["skills"]) {
  console.log(
    `${label}: benign ${counts.benign}, suspicious ${counts.suspicious}, malicious ${counts.malicious}, pending ${counts.pending}, unknown ${counts.unknown}`,
  );
}

function formatVersion(version: string | undefined) {
  return version ? `@${version}` : "";
}
