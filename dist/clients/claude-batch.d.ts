import type { TranslationJob, ClaudeResponse, BatchJob } from "../types/claude.js";
export declare class ClaudeBatchClient {
    private client?;
    private logger?;
    /** Tracks attribution per job_id (custom_id) until the batch completes. */
    private jobMetaByCustomId;
    private getClient;
    private getLogger;
    submitBatch(jobs: TranslationJob[]): Promise<string>;
    getBatchStatus(batchId: string): Promise<BatchJob>;
    pollBatchCompletion(batchId: string, maxWaitMs?: number): Promise<ClaudeResponse[]>;
    getBatchResultsIfReady(batchId: string): Promise<ClaudeResponse[] | null>;
    private formatBatchRequests;
    private parseBatchResults;
    /**
     * Same double-string handling as the synchronous Messages client.
     * Claude occasionally produces tool_use input where translations or
     * flags arrive as JSON strings instead of structured values; parse
     * them through jsonrepair so we don't reject otherwise-valid output.
     */
    private normalizeToolInput;
    /**
     * Read translations from the message's tool_use block. Anthropic
     * delivers `input` as a parsed object, so this path is JSON-safe.
     * Falls through to text-JSON parsing (with jsonrepair) for the rare
     * case Claude ignored tool_choice.
     *
     * Typed structurally because the Batch API returns BetaMessage and
     * the synchronous Messages API returns Message; their content-block
     * types diverge slightly but the shape we care about is identical.
     */
    private parseFromToolUse;
    private parseResponse;
    private extractUsage;
    private stripCodeFences;
    private sleep;
}
//# sourceMappingURL=claude-batch.d.ts.map