import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

type ArtifactKind = "skill" | "plugin";
type ArtifactKindFilter = "all" | ArtifactKind;
type ClawScanVerdict = "pass" | "suspicious" | "malicious" | "pending" | "failed" | "unknown";
type PipelineStatus = "none" | "queued" | "running" | "succeeded" | "failed";
type FailureStatus = "none" | "failed";

type CountBucket = {
  total: number;
  byVerdict: Record<ClawScanVerdict, number>;
  byScanJobStatus: Record<PipelineStatus, number>;
  byFailureStatus: Record<FailureStatus, number>;
};

type CurrentRollup = {
  artifactKind: ArtifactKind;
  rollupKind: "all" | "clawscanRiskBucket" | "clawscanCategory";
  categoryKey: string;
  categoryLabel?: string;
  clawScanVerdict: ClawScanVerdict;
  scanJobStatus: PipelineStatus;
  failureStatus: FailureStatus;
  count: number;
  totalForKind: number;
  percentageBasis: number;
  updatedAt: number;
};

type HourlyRollup = {
  bucketStartMs: number;
  artifactKind: ArtifactKind;
  clawScanVerdict: ClawScanVerdict;
  scanJobStatus: PipelineStatus;
  failureStatus: FailureStatus;
  count: number;
  updatedAt: number;
};

type ArtifactStateSummary = {
  artifactKind: ArtifactKind;
  artifactKey: string;
  targetKey: string;
  skillId?: Id<"skills">;
  skillVersionId?: Id<"skillVersions">;
  packageId?: Id<"packages">;
  packageReleaseId?: Id<"packageReleases">;
  ownerUserId: Id<"users">;
  ownerPublisherId?: Id<"publishers">;
  slug?: string;
  name?: string;
  displayName: string;
  version?: string;
  clawScanVerdict: ClawScanVerdict;
  clawScanStatus?: string;
  clawScanCheckedAt?: number;
  clawScanSummary?: string;
  clawScanModel?: string;
  clawScanPrimaryRiskBucket?: string;
  clawScanPrimaryCategoryKey?: string;
  clawScanPrimaryCategoryLabel?: string;
  clawScanVisibleFindingCount?: number;
  clawScanHighestSeverity?: string;
  scanJobStatus: PipelineStatus;
  failureStatus: FailureStatus;
  lastScanWorkerId?: string;
  lastScanAttempts?: number;
  lastScanUpdatedAt?: number;
  lastError?: string;
  skillSpectorStatus?: string;
  skillSpectorScore?: number;
  skillSpectorSeverity?: string;
  skillSpectorRecommendation?: string;
  skillSpectorIssueCount?: number;
  skillSpectorTopCategory?: string;
  staticStatus?: string;
  staticReasonCount?: number;
  vtStatus?: string;
  vtVerdict?: string;
  vtMalicious?: number;
  vtSuspicious?: number;
  evidenceUpdatedAt?: number;
  createdAt: number;
  updatedAt: number;
};

type SecurityScanOverviewResult = {
  generatedAt: number;
  window: {
    hours: number;
    startMs: number;
    endMs: number;
    totalsByKind: Partial<Record<ArtifactKind, CountBucket>>;
    rows: HourlyRollup[];
    truncated: boolean;
  };
  current: Partial<
    Record<
      ArtifactKind,
      {
        totals: CountBucket;
        rollups: CurrentRollup[];
        truncated: boolean;
      }
    >
  >;
  failed: {
    items: ArtifactStateSummary[];
    limit: number;
  };
};

type SecurityScanArtifactDetail = {
  found: boolean;
  artifactKind: ArtifactKind;
  reason?: "missing";
  state: ArtifactStateSummary | null;
  artifact?: {
    skill?: {
      _id: Id<"skills">;
      slug: string;
      displayName: string;
      latestVersionId?: Id<"skillVersions">;
    };
    version?: {
      _id: Id<"skillVersions">;
      version: string;
      createdAt: number;
    } | null;
    package?: {
      _id: Id<"packages">;
      name: string;
      displayName: string;
      family: string;
      latestReleaseId?: Id<"packageReleases">;
    };
    release?: {
      _id: Id<"packageReleases">;
      version: string;
      createdAt: number;
    } | null;
  };
  scanJob?: {
    _id: Id<"securityScanJobs">;
    status: string;
    source: string;
    attempts: number;
    workerId?: string;
    lastError?: string;
    updatedAt: number;
  } | null;
  evidence?: {
    clawScan: {
      status?: string;
      verdict?: string;
      confidence?: string;
      summary?: string;
      guidance?: string;
      findings?: string;
      model?: string;
      checkedAt?: number;
    };
    skillSpector: {
      status?: string;
      score?: number;
      severity?: string;
      recommendation?: string;
      issueCount?: number;
      checkedAt?: number;
      issues: Array<{
        issueId?: string;
        severity?: string;
        explanation?: string;
        finding?: string;
      }>;
    };
    staticScan?: {
      status: string;
      reasonCodes: string[];
      summary: string;
      checkedAt: number;
    };
    virusTotal?: {
      status?: string;
      verdict?: string;
      malicious?: number;
      suspicious?: number;
      checkedAt?: number;
    };
  };
};

const VERDICTS: ClawScanVerdict[] = [
  "pass",
  "suspicious",
  "malicious",
  "pending",
  "failed",
  "unknown",
];

const PIPELINE_STATUSES: PipelineStatus[] = ["queued", "running", "succeeded", "failed"];

type SecurityScanOverviewProps = {
  selectedSkillSlug?: string;
  selectedPluginName?: string;
};

export function SecurityScanOverview({
  selectedSkillSlug,
  selectedPluginName,
}: SecurityScanOverviewProps) {
  const [artifactKind, setArtifactKind] = useState<ArtifactKindFilter>("all");
  const [windowHours, setWindowHours] = useState("24");
  const [lookupKind, setLookupKind] = useState<ArtifactKind>("skill");
  const [lookupValue, setLookupValue] = useState("");
  const [submittedLookup, setSubmittedLookup] = useState<{
    kind: ArtifactKind;
    value: string;
  } | null>(null);

  useEffect(() => {
    if (selectedSkillSlug) {
      setLookupKind("skill");
      setLookupValue(selectedSkillSlug);
      setSubmittedLookup({ kind: "skill", value: selectedSkillSlug });
      return;
    }
    if (selectedPluginName) {
      setLookupKind("plugin");
      setLookupValue(selectedPluginName);
      setSubmittedLookup({ kind: "plugin", value: selectedPluginName });
    }
  }, [selectedPluginName, selectedSkillSlug]);

  const overviewArgs = {
    artifactKind: artifactKind === "all" ? undefined : artifactKind,
    windowHours: Number(windowHours),
    failedLimit: 8,
  };
  const overview = useQuery(api.securityScanDigests.getStaffSecurityScanOverview, overviewArgs) as
    | SecurityScanOverviewResult
    | undefined;

  const detailArgs = submittedLookup
    ? submittedLookup.kind === "skill"
      ? { skillSlug: submittedLookup.value }
      : { packageName: submittedLookup.value }
    : "skip";
  const detail = useQuery(api.securityScanDigests.getStaffSecurityScanArtifact, detailArgs) as
    | SecurityScanArtifactDetail
    | undefined;

  const kinds = useMemo(() => {
    if (!overview) return [] as ArtifactKind[];
    return (Object.keys(overview.current) as ArtifactKind[]).filter(
      (kind) => overview.current[kind],
    );
  }, [overview]);
  const combinedCurrent = useMemo(
    () => combineCounts(kinds, (kind) => overview?.current[kind]?.totals),
    [kinds, overview],
  );
  const combinedWindow = useMemo(
    () => combineCounts(kinds, (kind) => overview?.window.totalsByKind[kind]),
    [kinds, overview],
  );

  const onSubmitLookup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = lookupValue.trim();
    if (!value) return;
    setSubmittedLookup({ kind: lookupKind, value });
  };

  return (
    <Card className="mt-5 security-scan-overview">
      <div className="management-section-header">
        <div>
          <h2 className="section-title text-[1.2rem] m-0">Security scans</h2>
          <p className="section-subtitle m-0">
            ClawScan verdicts are primary. SkillSpector, static, and VirusTotal are evidence.
          </p>
        </div>
        {overview ? (
          <div className="management-count">Updated {formatTimestamp(overview.generatedAt)}</div>
        ) : null}
      </div>

      <div className="management-controls security-scan-controls">
        <div className="security-scan-segment" aria-label="Artifact kind">
          {(["all", "skill", "plugin"] as ArtifactKindFilter[]).map((kind) => (
            <button
              key={kind}
              type="button"
              className="security-scan-segment-button"
              aria-pressed={artifactKind === kind}
              onClick={() => setArtifactKind(kind)}
            >
              {kind === "all" ? "All" : formatArtifactKind(kind)}
            </button>
          ))}
        </div>
        <label className="management-control management-control-stack security-scan-window">
          <span className="mono">Window</span>
          <Select value={windowHours} onValueChange={setWindowHours}>
            <SelectTrigger className="management-field">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24">Last 24 hours</SelectItem>
              <SelectItem value="72">Last 72 hours</SelectItem>
              <SelectItem value="168">Last 7 days</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>

      {!overview ? (
        <div className="stat security-scan-empty">Loading security scan overview...</div>
      ) : combinedCurrent.total === 0 ? (
        <div className="stat security-scan-empty">No security scan digest rows yet.</div>
      ) : (
        <>
          <div className="security-scan-metric-grid" aria-label="Security scan status summary">
            {PIPELINE_STATUSES.map((status) => (
              <Metric
                key={status}
                label={formatPipelineStatus(status)}
                value={combinedCurrent.byScanJobStatus[status]}
                detail={`${formatPercent(
                  combinedCurrent.byScanJobStatus[status],
                  combinedCurrent.total,
                )} of current artifacts`}
              />
            ))}
          </div>

          <div className="security-scan-grid">
            <section className="security-scan-panel">
              <div className="management-section-header">
                <h3 className="section-title text-[1rem] m-0">Current verdicts</h3>
                <span className="management-count">
                  {formatNumber(combinedCurrent.total)} artifacts
                </span>
              </div>
              <div className="security-verdict-list">
                {VERDICTS.map((verdict) => (
                  <VerdictRow
                    key={verdict}
                    verdict={verdict}
                    count={combinedCurrent.byVerdict[verdict]}
                    total={combinedCurrent.total}
                  />
                ))}
              </div>
              <div className="security-kind-breakdown">
                {kinds.map((kind) => {
                  const totals = overview.current[kind]?.totals;
                  if (!totals) return null;
                  return (
                    <div key={kind} className="security-kind-row">
                      <span>{formatArtifactKind(kind)}</span>
                      <span>{formatNumber(totals.total)}</span>
                      <span>{formatPercent(totals.byVerdict.pass, totals.total)} pass</span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="security-scan-panel">
              <div className="management-section-header">
                <h3 className="section-title text-[1rem] m-0">ClawScan categories</h3>
                <span className="management-count">Current primary category</span>
              </div>
              <CategoryRows overview={overview} kinds={kinds} />
            </section>
          </div>

          <div className="security-scan-grid">
            <section className="security-scan-panel">
              <div className="management-section-header">
                <h3 className="section-title text-[1rem] m-0">
                  Last {overview.window.hours} hours
                </h3>
                <span className="management-count">
                  {formatNumber(combinedWindow.total)} scan events
                </span>
              </div>
              <div className="security-window-list">
                {overview.window.rows.length === 0 ? (
                  <div className="stat">No scan events in this window.</div>
                ) : (
                  overview.window.rows.slice(0, 8).map((row) => (
                    <div
                      key={`${row.artifactKind}-${row.bucketStartMs}-${row.clawScanVerdict}-${row.scanJobStatus}-${row.failureStatus}`}
                      className="security-window-row"
                    >
                      <span>{formatTimeBucket(row.bucketStartMs)}</span>
                      <Badge>{formatArtifactKind(row.artifactKind)}</Badge>
                      <span>{formatVerdict(row.clawScanVerdict)}</span>
                      <span>{formatPipelineStatus(row.scanJobStatus)}</span>
                      <strong>{formatNumber(row.count)}</strong>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="security-scan-panel">
              <div className="management-section-header">
                <h3 className="section-title text-[1rem] m-0">Failed scans</h3>
                <span className="management-count">Most recently updated</span>
              </div>
              <FailedScanRows rows={overview.failed.items} />
            </section>
          </div>
        </>
      )}

      <section className="security-scan-drilldown">
        <div className="management-section-header">
          <div>
            <h3 className="section-title text-[1rem] m-0">Artifact drilldown</h3>
            <p className="section-subtitle m-0">Inspect current ClawScan state and evidence.</p>
          </div>
        </div>
        <form className="management-tool-grid" onSubmit={onSubmitLookup}>
          <label className="management-control management-control-stack">
            <span className="mono">Artifact</span>
            <Select
              value={lookupKind}
              onValueChange={(value) => setLookupKind(value as ArtifactKind)}
            >
              <SelectTrigger className="management-field">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="skill">Skill slug</SelectItem>
                <SelectItem value="plugin">Plugin package</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="management-control management-control-stack">
            <span className="mono">{lookupKind === "skill" ? "Slug" : "Package"}</span>
            <input
              className="management-field"
              value={lookupValue}
              onChange={(event) => setLookupValue(event.target.value)}
              placeholder={lookupKind === "skill" ? "agentic-risk-demo" : "@scope/plugin-name"}
            />
          </label>
          <div className="management-control management-control-stack">
            <span className="mono">Action</span>
            <Button className="management-action-btn" type="submit" disabled={!lookupValue.trim()}>
              Inspect
            </Button>
          </div>
        </form>
        <DrilldownResult submitted={submittedLookup} detail={detail} />
      </section>
    </Card>
  );
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="security-metric">
      <span>{label}</span>
      <strong>{formatNumber(value)}</strong>
      <small>{detail}</small>
    </div>
  );
}

function VerdictRow({
  verdict,
  count,
  total,
}: {
  verdict: ClawScanVerdict;
  count: number;
  total: number;
}) {
  return (
    <div className="security-verdict-row" data-verdict={verdict}>
      <span>{formatVerdict(verdict)}</span>
      <div className="security-verdict-bar" aria-hidden="true">
        <span style={{ width: `${Math.min(100, percentValue(count, total))}%` }} />
      </div>
      <strong>
        {formatNumber(count)}/{formatNumber(total)} ({formatPercent(count, total)})
      </strong>
    </div>
  );
}

function CategoryRows({
  overview,
  kinds,
}: {
  overview: SecurityScanOverviewResult;
  kinds: ArtifactKind[];
}) {
  const categoryRows = kinds
    .flatMap((kind) => overview.current[kind]?.rollups ?? [])
    .filter((row) => row.rollupKind === "clawscanCategory" && row.categoryKey !== "all")
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  if (categoryRows.length === 0) {
    return <div className="stat">No ClawScan category rollups yet.</div>;
  }

  return (
    <div className="security-category-list">
      {categoryRows.map((row) => (
        <div
          key={`${row.artifactKind}-${row.categoryKey}-${row.clawScanVerdict}-${row.scanJobStatus}`}
          className="security-category-row"
        >
          <div>
            <strong>{row.categoryLabel ?? row.categoryKey}</strong>
            <span>
              {formatArtifactKind(row.artifactKind)} · {formatVerdict(row.clawScanVerdict)}
            </span>
          </div>
          <span>
            {formatNumber(row.count)}/{formatNumber(row.percentageBasis)} (
            {formatPercent(row.count, row.percentageBasis)})
          </span>
        </div>
      ))}
    </div>
  );
}

function FailedScanRows({ rows }: { rows: ArtifactStateSummary[] }) {
  if (rows.length === 0) {
    return <div className="stat">No failed scans.</div>;
  }
  return (
    <div className="security-failed-list">
      {rows.map((row) => (
        <div key={`${row.artifactKind}-${row.artifactKey}`} className="security-failed-row">
          <div>
            <strong>{row.displayName}</strong>
            <span>
              {formatArtifactKind(row.artifactKind)} · {row.version ? `v${row.version}` : "latest"}{" "}
              · {formatTimestamp(row.updatedAt)}
            </span>
            {row.lastError ? <small>{row.lastError}</small> : null}
          </div>
          {row.artifactKind === "skill" && row.slug ? (
            <Button asChild size="sm">
              <Link to="/management" search={{ skill: row.slug, plugin: undefined }}>
                Inspect
              </Link>
            </Button>
          ) : row.artifactKind === "plugin" && row.name ? (
            <Button asChild size="sm">
              <Link to="/management" search={{ skill: undefined, plugin: row.name }}>
                Inspect
              </Link>
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function DrilldownResult({
  submitted,
  detail,
}: {
  submitted: { kind: ArtifactKind; value: string } | null;
  detail: SecurityScanArtifactDetail | undefined;
}) {
  if (!submitted) {
    return (
      <div className="stat security-scan-empty">Enter a skill slug or plugin package name.</div>
    );
  }
  if (detail === undefined) {
    return <div className="stat security-scan-empty">Loading scan detail...</div>;
  }
  if (!detail.found) {
    return (
      <div className="stat security-scan-empty">
        No {formatArtifactKind(submitted.kind).toLowerCase()} found for "{submitted.value}".
      </div>
    );
  }

  const state = detail.state;
  const evidence = detail.evidence;
  const artifactDisplayName =
    state?.displayName ??
    detail.artifact?.skill?.displayName ??
    detail.artifact?.package?.displayName ??
    submitted.value;
  const artifactVersion =
    state?.version ?? detail.artifact?.version?.version ?? detail.artifact?.release?.version;
  return (
    <div className="security-drilldown-result">
      <div className="security-drilldown-heading">
        <div>
          <strong>{artifactDisplayName}</strong>
          <span>
            {formatArtifactKind(detail.artifactKind)} ·{" "}
            {artifactVersion ? `v${artifactVersion}` : "latest"} ·{" "}
            {state ? formatVerdict(state.clawScanVerdict) : "No digest state"}
          </span>
        </div>
        {state ? (
          <Badge>{formatPipelineStatus(state.scanJobStatus)}</Badge>
        ) : (
          <Badge>No digest row</Badge>
        )}
      </div>

      <div className="security-evidence-grid">
        <EvidenceBlock
          title="ClawScan"
          rows={[
            ["Verdict", evidence?.clawScan.verdict ?? state?.clawScanVerdict ?? "unknown"],
            ["Status", evidence?.clawScan.status ?? state?.clawScanStatus ?? "unknown"],
            ["Confidence", evidence?.clawScan.confidence ?? "n/a"],
            [
              "Category",
              state?.clawScanPrimaryCategoryLabel ?? state?.clawScanPrimaryCategoryKey ?? "n/a",
            ],
            ["Summary", evidence?.clawScan.summary ?? state?.clawScanSummary ?? "No summary."],
          ]}
        />
        <EvidenceBlock
          title="SkillSpector"
          rows={[
            ["Status", evidence?.skillSpector.status ?? state?.skillSpectorStatus ?? "n/a"],
            [
              "Score",
              evidence?.skillSpector.score !== undefined
                ? String(evidence.skillSpector.score)
                : state?.skillSpectorScore !== undefined
                  ? String(state.skillSpectorScore)
                  : "n/a",
            ],
            ["Severity", evidence?.skillSpector.severity ?? state?.skillSpectorSeverity ?? "n/a"],
            [
              "Issues",
              String(evidence?.skillSpector.issueCount ?? state?.skillSpectorIssueCount ?? 0),
            ],
          ]}
        />
        <EvidenceBlock
          title="Other scanners"
          rows={[
            ["Static", evidence?.staticScan?.status ?? state?.staticStatus ?? "n/a"],
            [
              "Static reasons",
              String(state?.staticReasonCount ?? evidence?.staticScan?.reasonCodes?.length ?? 0),
            ],
            [
              "VirusTotal",
              evidence?.virusTotal?.verdict ?? state?.vtVerdict ?? state?.vtStatus ?? "n/a",
            ],
            [
              "VT detections",
              `${state?.vtMalicious ?? evidence?.virusTotal?.malicious ?? 0} malicious / ${
                state?.vtSuspicious ?? evidence?.virusTotal?.suspicious ?? 0
              } suspicious`,
            ],
          ]}
        />
        <EvidenceBlock
          title="Worker"
          rows={[
            ["Job", detail.scanJob?._id ?? "n/a"],
            ["Source", detail.scanJob?.source ?? "n/a"],
            ["Attempts", String(detail.scanJob?.attempts ?? state?.lastScanAttempts ?? 0)],
            ["Worker", detail.scanJob?.workerId ?? state?.lastScanWorkerId ?? "n/a"],
            ["Error", detail.scanJob?.lastError ?? state?.lastError ?? "None"],
          ]}
        />
      </div>

      {evidence?.skillSpector.issues.length ? (
        <div className="management-sublist security-issue-list">
          <div className="section-subtitle m-0">SkillSpector issues</div>
          {evidence.skillSpector.issues.slice(0, 5).map((issue, index) => (
            <div key={issue.issueId ?? index} className="management-report-item">
              <span className="management-report-meta">
                {issue.severity ?? "unknown"} · {issue.issueId ?? `issue ${index + 1}`}
              </span>
              <span>{issue.finding ?? issue.explanation ?? "No explanation."}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EvidenceBlock({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <section className="security-evidence-block">
      <h4>{title}</h4>
      {rows.map(([label, value]) => (
        <div key={label} className="management-report-item">
          <span className="management-report-meta">{label}</span>
          <span>{value}</span>
        </div>
      ))}
    </section>
  );
}

function combineCounts(
  kinds: ArtifactKind[],
  getCounts: (kind: ArtifactKind) => CountBucket | undefined,
): CountBucket {
  const combined = makeEmptyCounts();
  for (const kind of kinds) {
    const counts = getCounts(kind);
    if (!counts) continue;
    combined.total += counts.total;
    for (const verdict of VERDICTS) combined.byVerdict[verdict] += counts.byVerdict[verdict] ?? 0;
    for (const status of ["none", ...PIPELINE_STATUSES] as PipelineStatus[]) {
      combined.byScanJobStatus[status] += counts.byScanJobStatus[status] ?? 0;
    }
    combined.byFailureStatus.none += counts.byFailureStatus.none ?? 0;
    combined.byFailureStatus.failed += counts.byFailureStatus.failed ?? 0;
  }
  return combined;
}

function makeEmptyCounts(): CountBucket {
  return {
    total: 0,
    byVerdict: {
      pass: 0,
      suspicious: 0,
      malicious: 0,
      pending: 0,
      failed: 0,
      unknown: 0,
    },
    byScanJobStatus: {
      none: 0,
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
    },
    byFailureStatus: {
      none: 0,
      failed: 0,
    },
  };
}

function formatArtifactKind(kind: ArtifactKind) {
  return kind === "skill" ? "Skills" : "Plugins";
}

function formatVerdict(verdict: string) {
  return verdict.charAt(0).toUpperCase() + verdict.slice(1);
}

function formatPipelineStatus(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatNumber(value: number) {
  return value.toLocaleString();
}

function percentValue(count: number, total: number) {
  if (total <= 0) return 0;
  return (count / total) * 100;
}

function formatPercent(count: number, total: number) {
  return `${Math.round(percentValue(count, total))}%`;
}

function formatTimestamp(value: number) {
  return new Date(value).toLocaleString();
}

function formatTimeBucket(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
