export interface BackfillOptions {
    /** Narrow to specific key ids. Default: all reviewed source keys. */
    keyIds?: number[];
    /** Narrow to specific target languages. Default: every non-source lang. */
    languages?: string[];
    /** Cap how many (key, lang) pairs we fire. Useful for manual dry-runs. */
    maxItems?: number;
    /** Target a specific project. Default: all configured projects. */
    projectId?: string;
}
export interface BackfillSummary {
    runId: string;
    keysInspected: number;
    staleItems: number;
    submitted: number;
    skipped: number;
    errors: number;
    durationMs: number;
}
/**
 * Run backfill for all configured projects (or a specific one via opts.projectId).
 */
export declare function runBackfill(opts?: BackfillOptions): Promise<BackfillSummary[]>;
//# sourceMappingURL=backfill.d.ts.map