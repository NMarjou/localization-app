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
    private parseResponse;
    private extractUsage;
    private stripCodeFences;
    private sleep;
}
//# sourceMappingURL=claude-batch.d.ts.map