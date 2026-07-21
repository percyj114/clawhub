const SKILLS_SH_API_BASE = "https://skills.sh/api/v1";
const MAX_SOURCE_PAGE_SIZE = 500;
const MAX_TEST_SCAN_ADMISSIONS = 10;

export type SkillsShCatalogSourceEnv = {
  CLAWHUB_SKILLS_SH_TEST_LIVE_FETCH_ENABLED?: string;
  VERCEL_ENV?: string;
  VERCEL_OIDC_TOKEN?: string;
  VERCEL_TARGET_ENV?: string;
  VITE_CLAWHUB_DEPLOY_ENV?: string;
};

export type SkillsShCatalogListRow = {
  id: string;
  installUrl: string | null;
  installs: number;
  name: string;
  slug: string;
  source: string;
  sourceType: string;
  url: string;
};

export type SkillsShCatalogDetail = {
  id: string;
  source: string;
  slug: string;
  installs: number;
  hash: string;
  files: Array<{
    name: string;
    content: string;
  }>;
};

type SkillsShCatalogPage = {
  data: SkillsShCatalogListRow[];
  pagination: {
    page: number;
    perPage: number;
    total: number;
    hasMore: boolean;
  };
};

type SkillsShCatalogSearch = {
  data: SkillsShCatalogListRow[];
};

function assertIntegerInRange(name: string, value: number, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
}

function requireOidcToken(env: SkillsShCatalogSourceEnv) {
  const token = env.VERCEL_OIDC_TOKEN?.trim();
  if (!token) {
    throw new Error("skills.sh catalog source requires VERCEL_OIDC_TOKEN");
  }
  return token;
}

async function fetchSkillsShJson<T>(
  path: string,
  options: {
    env?: SkillsShCatalogSourceEnv;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<T> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${SKILLS_SH_API_BASE}${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${requireOidcToken(env)}`,
    },
  });
  if (!response.ok) {
    throw new Error(`skills.sh catalog source returned HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchSkillsShCatalogPage(
  args: {
    page: number;
    perPage: number;
  },
  options: {
    env?: SkillsShCatalogSourceEnv;
    fetchImpl?: typeof fetch;
  } = {},
) {
  assertIntegerInRange("page", args.page, 0, 100_000);
  assertIntegerInRange("perPage", args.perPage, 1, MAX_SOURCE_PAGE_SIZE);
  return await fetchSkillsShJson<SkillsShCatalogPage>(
    `/skills?page=${args.page}&per_page=${args.perPage}`,
    options,
  );
}

export async function searchSkillsShCatalog(
  args: {
    query: string;
    owner?: string;
    limit: number;
  },
  options: {
    env?: SkillsShCatalogSourceEnv;
    fetchImpl?: typeof fetch;
  } = {},
) {
  assertIntegerInRange("limit", args.limit, 1, MAX_SOURCE_PAGE_SIZE);
  const params = new URLSearchParams({
    q: args.query,
    limit: String(args.limit),
  });
  if (args.owner) params.set("owner", args.owner);
  return await fetchSkillsShJson<SkillsShCatalogSearch>(
    `/skills/search?${params.toString()}`,
    options,
  );
}

export async function fetchSkillsShCatalogDetail(
  id: string,
  options: {
    env?: SkillsShCatalogSourceEnv;
    fetchImpl?: typeof fetch;
  } = {},
) {
  const normalizedId = id
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  if (normalizedId.split("/").length !== 3) {
    throw new Error("skills.sh catalog detail id must be owner/repo/skill");
  }
  return await fetchSkillsShJson<SkillsShCatalogDetail>(`/skills/${normalizedId}`, options);
}

export function getSkillsShCatalogTestSourcePolicy(env: SkillsShCatalogSourceEnv = process.env) {
  const targetEnvironment =
    env.VITE_CLAWHUB_DEPLOY_ENV?.trim() ||
    env.VERCEL_TARGET_ENV?.trim() ||
    env.VERCEL_ENV?.trim() ||
    "unknown";
  if (targetEnvironment !== "test") {
    return {
      allowed: false as const,
      environment: targetEnvironment,
      reason: "skills.sh live Test discovery requires the permanent Vercel Test environment",
    };
  }
  if (env.CLAWHUB_SKILLS_SH_TEST_LIVE_FETCH_ENABLED !== "1") {
    return {
      allowed: false as const,
      environment: "test",
      reason: "skills.sh live Test discovery is disabled",
    };
  }
  if (!env.VERCEL_OIDC_TOKEN?.trim()) {
    return {
      allowed: false as const,
      environment: "test",
      reason: "skills.sh live Test discovery requires VERCEL_OIDC_TOKEN",
    };
  }
  return {
    allowed: true as const,
    environment: "test",
    maxDiscoveryRows: MAX_SOURCE_PAGE_SIZE,
    maxRealScanAdmissions: MAX_TEST_SCAN_ADMISSIONS,
  };
}
