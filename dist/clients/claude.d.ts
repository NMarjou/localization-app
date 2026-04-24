import type { ClaudeResponse, ModelOption, TranslateOptions } from "../types/claude.js";
import type { PromptMessages } from "../types/prompt.js";
export declare class ClaudeClient {
    private logger?;
    private messagesClient;
    private batchClient;
    private getLogger;
    translate(prompts: PromptMessages, options?: TranslateOptions): Promise<ClaudeResponse | {
        batch_id: string;
    }>;
    pollBatchResult(batchId: string, maxWaitMs?: number): Promise<ClaudeResponse[]>;
    /** Always uses the Messages API (synchronous). Used by backfill concurrency loop. */
    translateSync(prompts: PromptMessages, model?: ModelOption): Promise<ClaudeResponse>;
    submitBackfillBatch(jobs: Array<{
        id: string;
        prompts: PromptMessages;
        model: ModelOption;
        estimatedStringCount: number;
    }>): Promise<string>;
    getBatchResultsIfReady(batchId: string): Promise<ClaudeResponse[] | null>;
    private handleBatchJob;
    private validatePrompts;
    private estimateTokens;
    private estimateTextTokens;
    private generateJobId;
}
export declare const claudeClient: ClaudeClient;
//# sourceMappingURL=claude.d.ts.map