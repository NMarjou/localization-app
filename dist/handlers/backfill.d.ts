export interface BackfillOptions {
    /** Narrow to specific key ids. Default: all reviewed source keys. */
    keyIds?: number[];
    /** Narrow to specific target languages. Default: every non-source lang. */
    languages?: string[];
    /** Cap how many (key, lang) pairs we fire. Useful for manual dry-runs. */
    maxItems?: number;
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
 * Find keys whose en-US source has been reviewed but whose target
 * translations are either missing or older than the source, and push
 * each stale target through the normal translate pipeline.
 *
 * Used by:
 *  - POST /trigger/backfill (manual)
 *  - scheduled nightly job (later)
 *
 * Runs async: caller should kick this off and not await unless they want
 * the full summary.
 */
export declare function runBackfill(opts?: BackfillOptions): Promise<BackfillSummary>;
//# sourceMappingURL=backfill.d.ts.map