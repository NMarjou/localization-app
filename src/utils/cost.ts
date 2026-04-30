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

interface ModelPricing {
  /** Standard input rate, $/Mtok */
  input: number;
  /** Output rate, $/Mtok */
  output: number;
  /** Cache write rate (input written into cache), $/Mtok. Typically 1.25× input. */
  cacheWrite: number;
  /** Cache read rate (cache hits), $/Mtok. Typically 0.10× input. */
  cacheRead: number;
}

const PRICING: Record<ModelOption, ModelPricing> = {
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
export function calculateCost(
  usage: ClaudeUsage,
  model: ModelOption,
  isBatch: boolean
): CostBreakdown {
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
export function formatUsd(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.0001) return `$${n.toExponential(2)}`;
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}
