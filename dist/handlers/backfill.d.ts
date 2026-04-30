export interface BackfillOptions {
    /** Narrow to specific key ids. Default: all reviewed source keys. */
    keyIds?: number[];
    /** Narrow to specific target languages. Default: every non-source lang. */
    languages?: string[];
    /** Cap how many (key, lang) pairs we fire. Useful for manual dry-runs. */
    maxItems?: number;
    /** Target a specific project. Default: all configured projects. */
    projectId?: string;
    /**
     * If true (default), only translate keys whose source string is
     * `is_reviewed`. Set to false to also pick up unreviewed source strings —
     * useful when imported keys haven't been manually approved in Lokalise yet.
     */
    requireReviewedSource?: boolean;
    /**
     * If true, re-translate every matching key regardless of whether the
     * target is already up-to-date. Use after changing prompts/rules to
     * regenerate existing translations under the new instructions.
     *
     * Combine with `languages` and/or `keyIds` to scope the reprocessing.
     * Without scoping, force=true regenerates the entire project — that
     * can be expensive and overwrite reviewed translations, so keep it
     * narrow.
     */
    force?: boolean;
}
export interface BackfillSummary {
    runId: string;
    keysInspected: number;
    staleItems: number;
    submitted: number;
    /** Capped off by opts.maxItems. */
    skipped: number;
    errors: number;
    /** Diagnostic: how many keys were silently skipped, and why. */
    skipReasons: {
        noSourceTranslation: number;
        emptySource: number;
        notReviewed: number;
        /** Keys translated correctly for the target language already. */
        upToDate: number;
    };
    /**
     * Diagnostic: a sample of up to 20 key IDs per skip reason. Helps you
     * spot what's getting missed without grepping logs.
     */
    skipSamples: {
        noSourceTranslation: number[];
        emptySource: number[];
        notReviewed: number[];
    };
    durationMs: number;
}
/**
 * Run backfill for all configured projects (or a specific one via opts.projectId).
 */
export declare function runBackfill(opts?: BackfillOptions): Promise<BackfillSummary[]>;
//# sourceMappingURL=backfill.d.ts.map