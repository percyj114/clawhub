import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

vi.mock("./lib/badges", async () => {
  const actual = await vi.importActual<typeof import("./lib/badges")>("./lib/badges");
  return {
    ...actual,
    getSkillBadgeMap: vi.fn(async () => ({})),
  };
});

const { getAuthUserId } = await import("@convex-dev/auth/server");
const { getBySlug, getSecurityVerdictTargetInternal } = await import("./skills");

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const getBySlugHandler = (
  getBySlug as unknown as WrappedHandler<{
    slug: string;
  }>
)._handler;

const getSecurityVerdictTargetInternalHandler = (
  getSecurityVerdictTargetInternal as unknown as WrappedHandler<
    {
      slug: string;
      version: string;
    },
    {
      moderationInfo: {
        isSuspicious: boolean;
        reasonCodes?: string[];
      } | null;
      version: { version: string } | null;
    } | null
  >
)._handler;

function makeBaseSkill() {
  const moderationStatus: "active" | "hidden" | "removed" = "active";
  const moderationVerdict: "clean" | "suspicious" | "malicious" = "clean";
  const moderationFlags: string[] | undefined = undefined;
  const moderationReasonCodes: string[] = ["suspicious.dynamic_code_execution"];

  return {
    _id: "skills:1",
    _creationTime: 1,
    slug: "padel",
    displayName: "Padel",
    summary: "A test skill",
    ownerUserId: "users:owner",
    canonicalSkillId: undefined,
    forkOf: undefined,
    latestVersionId: "skillVersions:1",
    tags: { latest: "0.1.0" },
    badges: {},
    stats: {
      downloads: 0,
      stars: 0,
      installsCurrent: 0,
      installsAllTime: 0,
      versions: 1,
      comments: 0,
    },
    createdAt: 10,
    updatedAt: 20,
    softDeletedAt: undefined,
    moderationStatus,
    moderationReason: "manual.override.clean",
    moderationVerdict,
    moderationFlags,
    moderationReasonCodes,
    moderationSummary: "Manual override (clean): internal staff note",
    moderationEngineVersion: "v2.0.0",
    moderationEvaluatedAt: 30,
    manualOverride: {
      verdict: "clean",
      note: "internal staff note",
      reviewerUserId: "users:moderator",
      updatedAt: 30,
    },
    isSuspicious: false,
  };
}

type SkillFixture = ReturnType<typeof makeBaseSkill>;
type SkillFixtureOverrides = Partial<
  Omit<SkillFixture, "moderationFlags" | "moderationStatus" | "moderationVerdict">
> & {
  moderationFlags?: string[];
  moderationStatus?: "active" | "hidden" | "removed";
  moderationVerdict?: "clean" | "suspicious" | "malicious";
};

function makeCtx(
  options: { skill?: SkillFixtureOverrides; latestVersion?: Record<string, unknown> } = {},
) {
  const skill = {
    ...makeBaseSkill(),
    ...options.skill,
  };

  const latestVersion = {
    _id: "skillVersions:1",
    skillId: "skills:1",
    version: "0.1.0",
    ...options.latestVersion,
  };

  const owner = {
    _id: "users:owner",
    _creationTime: 2,
    handle: "local",
    name: "Local Dev",
    displayName: "Local Dev",
    deletedAt: undefined,
    deactivatedAt: undefined,
  };

  const query = vi.fn((table: string) => {
    if (table === "skills") {
      return {
        withIndex: vi.fn(() => ({
          unique: vi.fn(async () => skill),
        })),
      };
    }
    throw new Error(`Unexpected query table: ${table}`);
  });

  const get = vi.fn(async (id: string) => {
    if (id === "skillVersions:1") return latestVersion;
    if (id === "users:owner") return owner;
    return null;
  });

  return {
    ctx: {
      db: { query, get },
    } as never,
  };
}

describe("getBySlug public moderation info", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(getAuthUserId).mockReset();
  });

  it("does not expose manual override notes to non-owners", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue(null);

    const { ctx } = makeCtx();
    const result = (await getBySlugHandler(ctx, {
      slug: "padel",
    })) as {
      moderationInfo: {
        overrideActive: boolean;
        summary: string | null;
      } | null;
    };

    expect(result.moderationInfo?.overrideActive).toBe(true);
    expect(result.moderationInfo?.summary).toBe(
      "Security findings were reviewed by moderators and cleared for public use.",
    );
  });

  it("keeps manual hidden moderation when scrubbing retired dependency registry codes", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);

    const { ctx } = makeCtx({
      skill: {
        moderationStatus: "hidden",
        moderationReason: "quality.low",
        moderationVerdict: "suspicious",
        moderationFlags: ["flagged.suspicious"],
        moderationReasonCodes: ["suspicious.dep_not_found_on_registry"],
        moderationSummary: "Quality hold",
        manualOverride: undefined,
      },
    });
    const result = (await getBySlugHandler(ctx, {
      slug: "padel",
    })) as {
      moderationInfo: {
        isHiddenByMod: boolean;
        isSuspicious: boolean;
        reason?: string;
        reasonCodes?: string[];
        summary?: string;
        verdict?: string;
      } | null;
    };

    expect(result.moderationInfo?.isHiddenByMod).toBe(true);
    expect(result.moderationInfo?.isSuspicious).toBe(true);
    expect(result.moderationInfo?.verdict).toBe("suspicious");
    expect(result.moderationInfo?.reasonCodes).toBeUndefined();
    expect(result.moderationInfo?.summary).toBe("Quality hold");
    expect(result.moderationInfo?.reason).toBe("quality.low");
  });

  it("returns effective non-suspicious public skill state after retired scanner codes are scrubbed", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue(null);

    const { ctx } = makeCtx({
      skill: {
        moderationReason: "scanner.aggregate.suspicious",
        moderationVerdict: "suspicious",
        moderationFlags: ["flagged.suspicious"],
        moderationReasonCodes: ["suspicious.dep_not_found_on_registry"],
        moderationSummary: "Detected: suspicious.dep_not_found_on_registry",
        manualOverride: undefined,
        isSuspicious: true,
      },
    });
    const result = (await getBySlugHandler(ctx, {
      slug: "padel",
    })) as {
      skill: {
        isSuspicious?: boolean;
      };
      moderationInfo: object | null;
    };

    expect(result.skill.isSuspicious).toBe(false);
    expect(result.moderationInfo).toBeNull();
  });

  it("keeps retired scanner-only hidden skills publicly visible after runtime scrub", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue(null);

    const { ctx } = makeCtx({
      skill: {
        moderationStatus: "hidden",
        moderationReason: "scanner.aggregate.suspicious",
        moderationVerdict: "suspicious",
        moderationFlags: ["flagged.suspicious"],
        moderationReasonCodes: ["suspicious.dep_not_found_on_registry"],
        moderationSummary: "Detected: suspicious.dep_not_found_on_registry",
        manualOverride: undefined,
        isSuspicious: true,
      },
    });

    const result = (await getBySlugHandler(ctx, {
      slug: "padel",
    })) as {
      skill: {
        isSuspicious?: boolean;
      };
      moderationInfo: object | null;
    } | null;

    expect(result?.skill.isSuspicious).toBe(false);
    expect(result?.moderationInfo).toBeNull();
  });

  it("keeps legacy scanner-malicious skills malware-blocked during runtime scrub", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue(null);

    const { ctx } = makeCtx({
      skill: {
        moderationStatus: "hidden",
        moderationReason: "scanner.vt.malicious",
        moderationVerdict: undefined,
        moderationFlags: undefined,
        moderationReasonCodes: ["suspicious.dep_not_found_on_registry"],
        moderationSummary: "Detected: suspicious.dep_not_found_on_registry",
        manualOverride: undefined,
        isSuspicious: true,
      },
    });

    const result = (await getBySlugHandler(ctx, {
      slug: "padel",
    })) as {
      skill: {
        isSuspicious?: boolean;
      };
      moderationInfo: {
        isMalwareBlocked?: boolean;
        isHiddenByMod?: boolean;
        verdict?: string;
        summary?: string;
      } | null;
    } | null;

    expect(result?.skill.isSuspicious).toBe(false);
    expect(result?.moderationInfo?.isMalwareBlocked).toBe(true);
    expect(result?.moderationInfo?.isHiddenByMod).toBe(false);
    expect(result?.moderationInfo?.verdict).toBe("malicious");
    expect(result?.moderationInfo?.summary).toBe("Detected: malicious scanner verdict");
  });

  it("scrubs retired dependency registry static scan findings from public versions", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue(null);

    const { ctx } = makeCtx({
      latestVersion: {
        staticScan: {
          status: "suspicious",
          reasonCodes: ["suspicious.dep_not_found_on_registry"],
          findings: [
            {
              code: "suspicious.dep_not_found_on_registry",
              severity: "critical",
              file: "package.json",
              line: 1,
              message: "Dependency does not appear in the package registry.",
              evidence: "legacy dependency registry evidence",
            },
          ],
          summary: "Detected: suspicious.dep_not_found_on_registry",
          engineVersion: "static-v1",
          checkedAt: 1,
        },
      },
    });

    const result = (await getBySlugHandler(ctx, {
      slug: "padel",
    })) as {
      latestVersion: {
        staticScan?: {
          status: string;
          reasonCodes: string[];
          findings: Array<{ code: string }>;
          summary: string;
        };
      };
    };

    expect(result.latestVersion.staticScan).toEqual({
      status: "clean",
      reasonCodes: [],
      findings: [],
      summary: "No suspicious patterns detected.",
      engineVersion: "static-v1",
      checkedAt: 1,
    });
  });

  it("keeps retired scanner-only hidden skills visible to security verdict targets", async () => {
    const skill = {
      _id: "skills:legacy",
      _creationTime: 1,
      slug: "legacy",
      displayName: "Legacy",
      summary: "Legacy dependency scan row",
      ownerUserId: "users:owner",
      latestVersionId: "skillVersions:legacy",
      tags: { latest: "1.0.0" },
      badges: {},
      stats: {
        downloads: 0,
        stars: 0,
        installsCurrent: 0,
        installsAllTime: 0,
        versions: 1,
        comments: 0,
      },
      createdAt: 10,
      updatedAt: 20,
      softDeletedAt: undefined,
      moderationStatus: "hidden",
      moderationReason: "scanner.aggregate.suspicious",
      moderationVerdict: "suspicious",
      moderationFlags: ["flagged.suspicious"],
      moderationReasonCodes: ["suspicious.dep_not_found_on_registry"],
      moderationSummary: "Detected: suspicious.dep_not_found_on_registry",
      moderationEngineVersion: "v2.0.0",
      moderationEvaluatedAt: 30,
      hiddenAt: 30,
      hiddenBy: "users:moderator",
    };
    const version = {
      _id: "skillVersions:legacy",
      skillId: "skills:legacy",
      version: "1.0.0",
      createdAt: 11,
      softDeletedAt: undefined,
      llmAnalysis: {
        status: "clean",
        verdict: "clean",
        checkedAt: 12,
      },
    };
    const owner = {
      _id: "users:owner",
      _creationTime: 2,
      handle: "local",
      name: "Local Dev",
      displayName: "Local Dev",
      deletedAt: undefined,
      deactivatedAt: undefined,
    };

    const query = vi.fn((table: string) => {
      if (table === "skills") {
        return {
          withIndex: vi.fn(() => ({
            unique: vi.fn(async () => skill),
          })),
        };
      }
      if (table === "skillVersions") {
        return {
          withIndex: vi.fn(() => ({
            unique: vi.fn(async () => version),
          })),
        };
      }
      throw new Error(`Unexpected query table: ${table}`);
    });
    const get = vi.fn(async (id: string) => {
      if (id === "users:owner") return owner;
      return null;
    });

    const result = await getSecurityVerdictTargetInternalHandler(
      { db: { query, get } },
      { slug: "legacy", version: "1.0.0" },
    );

    expect(result?.version?.version).toBe("1.0.0");
    expect(result?.moderationInfo).toBeNull();
  });
});
