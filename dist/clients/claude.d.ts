import type { ClaudeResponse, TranslateOptions } from "../types/claude.js";
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
    private handleBatchJob;
    private validatePrompts;
    private estimateTokens;
    private estimateTextTokens;
    private generateJobId;
}
export declare const claudeClient: ClaudeClient;
//# sourceMappingURL=claude.d.ts.map