import { type inferred } from "arktype";
export declare const SecurityScanStatusSchema: import("arktype/internal/variants/string.ts").StringType<"unknown" | "suspicious" | "malicious" | "pending" | "benign", {}>;
export type SecurityScanStatus = (typeof SecurityScanStatusSchema)[inferred];
export declare const SecurityScanCountsSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    benign: number;
    suspicious: number;
    malicious: number;
    pending: number;
    unknown: number;
}, {}>;
export type SecurityScanCounts = (typeof SecurityScanCountsSchema)[inferred];
export declare const ApiV1SecurityScanSummaryResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    generatedAt: number;
    updatedAt: number | null;
    stale: boolean;
    totals: {
        skills: {
            benign: number;
            suspicious: number;
            malicious: number;
            pending: number;
            unknown: number;
        };
        plugins: {
            benign: number;
            suspicious: number;
            malicious: number;
            pending: number;
            unknown: number;
        };
    };
}, {}>;
export type ApiV1SecurityScanSummaryResponse = (typeof ApiV1SecurityScanSummaryResponseSchema)[inferred];
export declare const ApiV1SecurityRescanResponseSchema: import("arktype/internal/variants/object.ts").ObjectType<{
    ok: boolean;
    state: "queued" | "already_in_progress" | "target_not_found" | "scanner_unavailable";
    entityType: "skill" | "plugin";
    target: string;
    scheduledScanners: string[];
    version?: string | undefined;
}, {}>;
export type ApiV1SecurityRescanResponse = (typeof ApiV1SecurityRescanResponseSchema)[inferred];
