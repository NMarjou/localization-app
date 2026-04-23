import type { TranslationJob, ClaudeResponse } from "../types/claude.js";
export declare class ClaudeMessagesClient {
    private client?;
    private logger?;
    private maxRetries;
    private retryDelay;
    private getClient;
    private getLogger;
    translate(job: TranslationJob): Promise<ClaudeResponse>;
    private parseResponse;
    private validateJSON;
    /**
     * Strip markdown code fences (```json ... ``` or ``` ... ```) that
     * Claude sometimes wraps JSON responses in, despite instructions.
     */
    private stripCodeFences;
    private extractUsage;
    private sleep;
}
//# sourceMappingURL=claude-messages.d.ts.map