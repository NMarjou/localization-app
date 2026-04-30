/**
 * Append-only JSONL log of every billed Claude call, plus aggregators for
 * the /cost endpoint.
 *
 * Each line is one CostEntry. Persisted to data/cost-log.jsonl so it
 * survives restarts. Aggregations are computed on demand by reading the
 * file — fine for our volumes (< 100k entries / yr expected).
 */
import type { ClaudeUsage, ModelOption } from "../types/claude.js";
export interface CostEntry {
    timestamp: number;
    jobId: string;
    projectId?: string;
    /** Lokalise target language ISO (e.g. "translations.nl") */
    targetLanguage?: string;
    model: ModelOption;
    isBatch: boolean;
    freshInputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    /** Final $ after discount */
    totalUsd: number;
    /** Pre-discount $ */
    listUsd: number;
}
/**
 * Record a single Claude call's usage + computed cost. Failures to write
 * the file are logged but never thrown — cost tracking must never block
 * a translation push.
 */
export declare function recordCost(args: {
    jobId: string;
    projectId?: string;
    targetLanguage?: string;
    model: ModelOption;
    isBatch: boolean;
    usage: ClaudeUsage;
}): Promise<CostEntry | undefined>;
export interface CostAggregate {
    calls: number;
    freshInputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    totalUsd: number;
    listUsd: number;
}
/** Aggregate plus pre-formatted strings ready to drop into a UI or terminal. */
export interface FormattedAggregate extends CostAggregate {
    totalUsdFormatted: string;
    listUsdFormatted: string;
    freshInputTokensFormatted: string;
    cacheReadTokensFormatted: string;
    outputTokensFormatted: string;
}
export interface FormattedCostEntry extends CostEntry {
    timestampIso: string;
    totalUsdFormatted: string;
}
export interface CostSummary {
    total: FormattedAggregate;
    byProject: Record<string, FormattedAggregate>;
    byProjectAndLanguage: Record<string, Record<string, FormattedAggregate>>;
    byProjectAndModel: Record<string, Record<string, FormattedAggregate>>;
    /** Last 50 entries, newest first, for debugging. */
    recent: FormattedCostEntry[];
    /** Human-readable plaintext breakdown ready to print. */
    formatted: string;
}
export interface CostSummaryFilter {
    projectId?: string;
    /** Inclusive lower bound, ms epoch */
    since?: number;
    /** Inclusive upper bound, ms epoch */
    until?: number;
}
export declare function summarizeCosts(filter?: CostSummaryFilter, projectNameLookup?: (id: string) => string): Promise<CostSummary>;
//# sourceMappingURL=cost-log.d.ts.map