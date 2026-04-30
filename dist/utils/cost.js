/**
 * Per-model pricing in USD per million tokens, plus the helpers used to
 * convert a Claude Usage object into a $ figure.
 *
 * Sources (April 2026):
 *   - https://www.anthropic.com/pricing#api
 *   - https://docs.claude.com/en/api/message-batches  (50% Batch discount)
 *   - https://docs.claude.com/en/api/prompt-caching   (90% read discount, 25% write surcharge)
 */
const PRICING = {
    "haiku-4-5": {
        input: 1.0,
        output: 5.0,
        cacheWrite: 1.25,
        cacheRead: 0.1,
    },
    "sonnet-4-6": {
        input: 3.0,
        output: 15.0,
        cacheWrite: 3.75,
        cacheRead: 0.3,
    },
};
/** Batch API discount (50% off both input and output). */
const BATCH_DISCOUNT = 0.5;
/**
 * Compute USD cost for a single Claude call.
 *
 * Note on token math: Anthropic's Usage reports cache_creation_input_tokens
 * and cache_read_input_tokens separately from input_tokens. input_tokens is
 * the count of NON-cached input (i.e. fresh tokens that weren't part of the
 * cache prefix). So total billable input = input + cacheWrite + cacheRead,
 * each priced differently.
 */
export function calculateCost(usage, model, isBatch) {
    const p = PRICING[model];
    const freshInputTokens = usage.input_tokens ?? 0;
    const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
    const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const inputCost = (freshInputTokens / 1_000_000) * p.input;
    const writeCost = (cacheWriteTokens / 1_000_000) * p.cacheWrite;
    const readCost = (cacheReadTokens / 1_000_000) * p.cacheRead;
    const outputCost = (outputTokens / 1_000_000) * p.output;
    const listUsd = inputCost + writeCost + readCost + outputCost;
    const batchDiscount = isBatch ? BATCH_DISCOUNT : 0;
    const totalUsd = listUsd * (1 - batchDiscount);
    return {
        totalUsd,
        listUsd,
        freshInputTokens,
        cacheWriteTokens,
        cacheReadTokens,
        outputTokens,
        batchDiscount,
    };
}
/** Pretty-print a USD figure with sensible precision for small amounts. */
export function formatUsd(n) {
    if (n === 0)
        return "$0.00";
    if (n < 0.0001)
        return `$${n.toExponential(2)}`;
    if (n < 0.01)
        return `$${n.toFixed(6)}`;
    if (n < 1)
        return `$${n.toFixed(4)}`;
    return `$${n.toFixed(2)}`;
}
//# sourceMappingURL=cost.js.map