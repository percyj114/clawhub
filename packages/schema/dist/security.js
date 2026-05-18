import { type } from "arktype";
export const SecurityScanStatusSchema = type('"benign"|"suspicious"|"malicious"|"pending"|"unknown"');
export const SecurityScanCountsSchema = type({
    benign: "number",
    suspicious: "number",
    malicious: "number",
    pending: "number",
    unknown: "number",
});
export const ApiV1SecurityScanSummaryResponseSchema = type({
    generatedAt: "number",
    updatedAt: "number|null",
    stale: "boolean",
    totals: {
        skills: SecurityScanCountsSchema,
        plugins: SecurityScanCountsSchema,
    },
});
export const ApiV1SecurityRescanResponseSchema = type({
    ok: "boolean",
    state: '"queued"|"already_in_progress"|"target_not_found"|"scanner_unavailable"',
    entityType: '"skill"|"plugin"',
    target: "string",
    version: "string?",
    scheduledScanners: "string[]",
});
//# sourceMappingURL=security.js.map