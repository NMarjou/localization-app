import type { TranslationJob, ClaudeResponse, BatchJob } from "../types/claude.js";
export declare class ClaudeBatchClient {
    private client?;
    private logger?;
    private getClient;
    private getLogger;
    submitBatch(jobs: TranslationJob[]): Promise<string>;
    getBatchStatus(batchId: string): Promise<BatchJob>;
    pollBatchCompletion(batchId: string, maxWaitMs?: number): Promise<ClaudeResponse[]>;
    private formatBatchRequests;
    private parseBatchResults;
    private parseResponse;
    private sleep;
}
//# sourceMappingURL=claude-batch.d.ts.map