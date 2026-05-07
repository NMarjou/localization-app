import type { TranslationJob, ClaudeResponse } from "../types/claude.js";
export declare class ClaudeMessagesClient {
    private client?;
    private logger?;
    private maxRetries;
    private retryDelay;
    private getClient;
    private getLogger;
    translate(job: TranslationJob): Promise<ClaudeResponse>;
    /**
     * Claude occasionally emits a tool_use input where `translations` and/or
     * `flags` are JSON STRINGS rather than the structured types declared by
     * the schema. We detect that here, parse the inner JSON (with jsonrepair
     * fallback), and return a normalized PromptResponse. If the input is
     * already structured correctly, this is a pass-through.
     */
    private normalizeToolInput;
    /**
     * Pull the translations out of a tool_use block. Anthropic guarantees
     * the input is valid JSON parsed against our schema — no string
     * parsing needed. If the model somehow ignored tool_choice and emitted
     * text instead, fall through to parseResponse() so jsonrepair still
     * gives us a chance.
     */
    private parseFromToolUse;
    private parseResponse;
    /**
     * Strip markdown code fences (```json ... ``` or ``` ... ```) that
     * Claude sometimes wraps JSON responses in, despite instructions.
     * Uses string operations instead of regex to handle large responses reliably.
     */
    private stripCodeFences;
    private extractUsage;
    private sleep;
}
//# sourceMappingURL=claude-messages.d.ts.map