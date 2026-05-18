import { type inferred, type } from "arktype";

export const SecurityScanStatusSchema = type(
  '"benign"|"suspicious"|"malicious"|"pending"|"unknown"',
);
export type SecurityScanStatus = (typeof SecurityScanStatusSchema)[inferred];

export const SecurityScanCountsSchema = type({
  benign: "number",
  suspicious: "number",
  malicious: "number",
  pending: "number",
  unknown: "number",
});
export type SecurityScanCounts = (typeof SecurityScanCountsSchema)[inferred];

export const ApiV1SecurityScanSummaryResponseSchema = type({
  generatedAt: "number",
  updatedAt: "number|null",
  stale: "boolean",
  totals: {
    skills: SecurityScanCountsSchema,
    plugins: SecurityScanCountsSchema,
  },
});
export type ApiV1SecurityScanSummaryResponse =
  (typeof ApiV1SecurityScanSummaryResponseSchema)[inferred];

export const ApiV1SecurityRescanResponseSchema = type({
  ok: "boolean",
  state: '"queued"|"already_in_progress"|"target_not_found"|"scanner_unavailable"',
  entityType: '"skill"|"plugin"',
  target: "string",
  version: "string?",
  scheduledScanners: "string[]",
});
export type ApiV1SecurityRescanResponse = (typeof ApiV1SecurityRescanResponseSchema)[inferred];
