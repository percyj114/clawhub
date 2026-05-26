/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SecurityScanOverview } from "./SecurityScanOverview";

const useQueryMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
  }: {
    children: React.ReactNode;
    to?: string;
    search?: Record<string, string | undefined>;
  }) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(search ?? {})) {
      if (value) params.set(key, value);
    }
    const query = params.toString();
    return <a href={`${to ?? "/"}${query ? `?${query}` : ""}`}>{children}</a>;
  },
}));

vi.mock("../ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <select value={value} onChange={(event) => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => children,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
}));

const NOW = Date.UTC(2026, 4, 26, 12, 0, 0);

function makeCounts(overrides?: {
  total?: number;
  pass?: number;
  suspicious?: number;
  malicious?: number;
  pending?: number;
  failed?: number;
  queued?: number;
  running?: number;
  succeeded?: number;
}) {
  return {
    total: overrides?.total ?? 0,
    byVerdict: {
      pass: overrides?.pass ?? 0,
      suspicious: overrides?.suspicious ?? 0,
      malicious: overrides?.malicious ?? 0,
      pending: overrides?.pending ?? 0,
      failed: overrides?.failed ?? 0,
      unknown: 0,
    },
    byScanJobStatus: {
      none: 0,
      queued: overrides?.queued ?? 0,
      running: overrides?.running ?? 0,
      succeeded: overrides?.succeeded ?? 0,
      failed: overrides?.failed ?? 0,
    },
    byFailureStatus: {
      none: (overrides?.total ?? 0) - (overrides?.failed ?? 0),
      failed: overrides?.failed ?? 0,
    },
  };
}

function makeOverview() {
  return {
    generatedAt: NOW,
    current: {
      skill: {
        totals: makeCounts({
          total: 10,
          pass: 6,
          suspicious: 1,
          malicious: 1,
          pending: 1,
          failed: 1,
          queued: 1,
          running: 2,
          succeeded: 6,
        }),
        rollups: [
          {
            artifactKind: "skill",
            rollupKind: "clawscanCategory",
            categoryKey: "permission_boundary",
            categoryLabel: "Permission boundary",
            clawScanVerdict: "malicious",
            scanJobStatus: "succeeded",
            failureStatus: "none",
            count: 1,
            totalForKind: 10,
            percentageBasis: 10,
            updatedAt: NOW,
          },
        ],
        truncated: false,
      },
      plugin: {
        totals: makeCounts({ total: 5, pass: 4, failed: 1, succeeded: 4 }),
        rollups: [],
        truncated: false,
      },
    },
    window: {
      hours: 24,
      startMs: NOW - 24 * 60 * 60 * 1000,
      endMs: NOW,
      totalsByKind: {
        skill: makeCounts({ total: 4, pass: 2, pending: 1, failed: 1, queued: 1, succeeded: 2 }),
        plugin: makeCounts({ total: 1, failed: 1 }),
      },
      rows: [
        {
          bucketStartMs: NOW - 60 * 60 * 1000,
          artifactKind: "skill",
          clawScanVerdict: "pass",
          scanJobStatus: "succeeded",
          failureStatus: "none",
          count: 2,
          updatedAt: NOW,
        },
      ],
      truncated: false,
    },
    failed: {
      limit: 8,
      items: [
        {
          artifactKind: "plugin",
          artifactKey: "plugin:packages:demo",
          targetKey: "packageRelease:packageReleases:demo",
          packageId: "packages:demo",
          packageReleaseId: "packageReleases:demo",
          ownerUserId: "users:owner",
          name: "@openclaw/demo",
          displayName: "Demo Plugin",
          version: "1.0.0",
          clawScanVerdict: "failed",
          scanJobStatus: "failed",
          failureStatus: "failed",
          lastError: "Worker timeout",
          createdAt: NOW - 10_000,
          updatedAt: NOW,
        },
      ],
    },
  };
}

function makeDetail() {
  return {
    found: true,
    artifactKind: "skill",
    state: {
      artifactKind: "skill",
      artifactKey: "skill:skills:demo",
      targetKey: "skillVersion:skillVersions:demo",
      skillId: "skills:demo",
      skillVersionId: "skillVersions:demo",
      ownerUserId: "users:owner",
      slug: "demo-skill",
      displayName: "Demo Skill",
      version: "1.2.3",
      clawScanVerdict: "malicious",
      clawScanStatus: "malicious",
      clawScanPrimaryCategoryLabel: "Permission boundary",
      scanJobStatus: "succeeded",
      failureStatus: "none",
      skillSpectorScore: 85,
      skillSpectorIssueCount: 12,
      staticStatus: "suspicious",
      vtVerdict: "clean",
      createdAt: NOW - 10_000,
      updatedAt: NOW,
    },
    scanJob: {
      _id: "securityScanJobs:demo",
      status: "succeeded",
      source: "manual",
      attempts: 2,
      workerId: "worker-a",
      updatedAt: NOW,
    },
    evidence: {
      clawScan: {
        status: "malicious",
        verdict: "malicious",
        confidence: "high",
        summary: "Exfiltrates secrets",
        checkedAt: NOW,
      },
      skillSpector: {
        status: "suspicious",
        score: 85,
        severity: "high",
        issueCount: 12,
        issues: [
          {
            issueId: "network-egress",
            severity: "high",
            finding: "Broad network egress",
          },
        ],
      },
      staticScan: {
        status: "suspicious",
        reasonCodes: ["network-egress"],
        summary: "Network use",
        checkedAt: NOW,
      },
      virusTotal: {
        verdict: "clean",
        malicious: 0,
        suspicious: 0,
      },
    },
  };
}

describe("SecurityScanOverview", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
  });

  it("renders a loading state while the overview query resolves", () => {
    useQueryMock.mockReturnValue(undefined);

    render(<SecurityScanOverview />);

    expect(screen.getByText("Loading security scan overview...")).toBeTruthy();
  });

  it("renders verdict, category, time-window, failed, queued, and running scan summaries", () => {
    useQueryMock.mockImplementation((_query: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      return makeOverview();
    });

    render(<SecurityScanOverview />);

    expect(screen.getByText("Security scans")).toBeTruthy();
    expect(screen.getByText("15 artifacts")).toBeTruthy();
    expect(screen.getByText("10/15 (67%)")).toBeTruthy();
    expect(screen.getByText("Permission boundary")).toBeTruthy();
    expect(screen.getByText("5 scan events")).toBeTruthy();
    expect(screen.getByText("Demo Plugin")).toBeTruthy();
    expect(screen.getByText("Worker timeout")).toBeTruthy();
    expect(screen.getByText("Queued")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
  });

  it("submits artifact drilldown and renders ClawScan and evidence scanner details", async () => {
    useQueryMock.mockImplementation((_query: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (typeof args === "object" && args && "skillSlug" in args) return makeDetail();
      return makeOverview();
    });

    render(<SecurityScanOverview />);

    fireEvent.change(screen.getByPlaceholderText("agentic-risk-demo"), {
      target: { value: "demo-skill" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));

    await waitFor(() => {
      expect(screen.getByText("Demo Skill")).toBeTruthy();
    });
    expect(screen.getByText("Exfiltrates secrets")).toBeTruthy();
    expect(screen.getByText("Broad network egress")).toBeTruthy();
    expect(screen.getByText("worker-a")).toBeTruthy();
  });

  it("uses the artifact summary when a drilldown has evidence but no digest state", async () => {
    useQueryMock.mockImplementation((_query: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (typeof args === "object" && args && "skillSlug" in args) {
        return {
          ...makeDetail(),
          state: null,
          artifact: {
            skill: {
              _id: "skills:demo",
              slug: "demo-skill",
              displayName: "Local Agentic Risk Demo",
            },
            version: {
              _id: "skillVersions:demo",
              version: "1.2.3",
              createdAt: NOW,
            },
          },
        };
      }
      return makeOverview();
    });

    render(<SecurityScanOverview />);

    fireEvent.change(screen.getByPlaceholderText("agentic-risk-demo"), {
      target: { value: "demo-skill" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));

    await waitFor(() => {
      expect(screen.getByText("Local Agentic Risk Demo")).toBeTruthy();
    });
    expect(screen.getByText(/No digest state/)).toBeTruthy();
  });
});
