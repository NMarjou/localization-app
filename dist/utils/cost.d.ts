/**
 * Per-model pricing in USD per million tokens, plus the helpers used to
 * convert a Claude Usage object into a $ figure.
 *
 * Sources (April 2026):
 *   - https://www.anthropic.com/pricing#api
 *   - https://docs.claude.com/en/api/message-batches  (50% Batch discount)
 *   - https://docs.claude.com/en/api/prompt-caching   (90% read discount, 25% write surcharge)
 */
import type { ClaudeUsage, ModelOption } from "../types/claude.js";
export interface CostBreakdown {
    /** Final USD cost */
    totalUsd: number;
    /** Pre-discount USD (handy for "you saved $X" UI) */
    listUsd: number;
    /** Tokens that were NEW input (not cache write/read) */
    freshInputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    /** What discount was applied: 0 for sync, 0.5 for batch */
    batchDiscount: number;
}
/**
 * Compute USD cost for a single Claude call.
 *
 * Note on token math: Anthropic's Usage reports cache_creation_input_tokens
 * and cache_read_input_tokens separately from input_tokens. input_tokens is
 * the count of NON-cached input (i.e. fresh tokens that weren't part of the
 * cache prefix). So total billable input = input + cacheWrite + cacheRead,
 * each priced differently.
 */
export declare function calculateCost(usage: ClaudeUsage, model: ModelOption, isBatch: boolean): CostBreakdown;
/** Pretty-print a USD figure with sensible precision for small amounts. */
export declare function formatUsd(n: number): string;
//# sourceMappingURL=cost.d.ts.map