---
summary: "Staff guide for ClawScan-first production security scan visibility."
read_when:
  - Checking production security scan health
  - Using the management security scan dashboard
  - Using clawhub-mod security-scans commands
title: "Security Scan Visibility"
sidebarTitle: "Security Scan Visibility"
---

# Security Scan Visibility

Admins and site moderators can use the management console and `clawhub-mod` to
see how the ClawHub security scan pipeline is doing across skills and plugins.
Use this view for operational questions such as:

- how many current artifacts pass, look suspicious, are malicious, are pending,
  failed, or unknown
- how the last 24 hours of scan events behaved
- which scans are queued, running, or failed
- what happened for one specific skill or plugin release

The staff dashboard is available at:

```text
/management
```

Open the Security scans section there to switch between all artifacts, skills,
and plugins; change the recent window; inspect ClawScan categories; review
failed scans; and drill into one skill slug or plugin package name.

## Source Of Truth

The top-level verdict is ClawScan/Codex. SkillSpector, static analysis,
VirusTotal, and worker details are evidence that helps explain the verdict; do
not treat them as the final verdict when reporting aggregate health.

| State        | Meaning                                                            |
| ------------ | ------------------------------------------------------------------ |
| `pass`       | ClawScan resolved the latest artifact without visible concerns.    |
| `suspicious` | ClawScan found concerns that deserve review before installation.   |
| `malicious`  | ClawScan determined the artifact should not be installed.          |
| `pending`    | ClawScan is queued/running or has not produced a final result yet. |
| `failed`     | The current scan job exhausted unsuccessfully.                     |
| `unknown`    | No current ClawScan result or scan job is available.               |

Pipeline status answers a different question:

| Pipeline status | Meaning                                      |
| --------------- | -------------------------------------------- |
| `queued`        | Waiting for a worker.                        |
| `running`       | Claimed by a worker.                         |
| `succeeded`     | Worker completed and persisted scan results. |
| `failed`        | Worker failed the current job.               |
| `none`          | No current worker job is attached.           |

## CLI Commands

Use `clawhub-mod` when you need copyable output, JSON, or an agent-consumable
view of the same data:

```bash
bun run mod -- security-scans overview --window-hours 24
bun run mod -- security-scans overview --window-hours 24 --json
bun run mod -- security-scans failed --artifact-kind all --limit 25 --json
bun run mod -- security-scans queued --artifact-kind plugin --limit 25
bun run mod -- security-scans running --artifact-kind skill --limit 25
bun run mod -- security-scans inspect --skill <slug> --json
bun run mod -- security-scans inspect --plugin <package-name> --json
```

For production, the default registry is `https://clawhub.ai`. For local or
staging checks, pass the registry explicitly:

```bash
bun run mod -- --registry <convex-http-url> security-scans overview
```

The API token must belong to an admin or moderator. Non-staff users receive a
permission error.

## Reporting

Report the ClawScan verdict first:

```text
pass: 98/124 (79%)
malicious: 4/124 (3%)
queued: 8
running: 1
failed: 2
```

When drilling into one artifact, summarize in this order:

1. ClawScan verdict, status, category, and summary.
2. Worker job status, attempts, queue/start/finish/failure times, and last error.
3. SkillSpector score, severity, and category as supporting evidence.
4. Static analysis and VirusTotal as supporting evidence.

## Scale Notes

The dashboard reads security scan digest tables instead of live-scanning every
skill, version, package, release, and scan job. This keeps the operator view
bounded and index-driven while production data grows.

This pattern is appropriate while the product needs current rollups, recent
hourly trends, failed samples, queue health, and single-artifact drilldown.
Reconsider the design if operators need arbitrary historical slicing across many
dimensions, very long retention windows in the dashboard, or unbounded exports
from the UI. Symptoms to watch for are slow backfills, large hourly rollup
growth, repeated Convex `documentsReadLimit` or `bytesReadLimit` errors, or
operator workflows that require joining many evidence rows on every request.

For agent workflows, use the repo-local `security-scan-overview` skill. It
keeps the same ClawScan-first reporting order and prefers bounded CLI/API reads
over scraping the UI.
