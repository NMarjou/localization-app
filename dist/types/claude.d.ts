import type { PromptMessages } from "./prompt.js";
export type ModelOption = "haiku-4-5" | "sonnet-4-6";
export interface TranslationJob {
    job_id: string;
    prompt_messages: PromptMessages;
    model: ModelOption;
    estimated_tokens?: number;
    is_batch?: boolean;
}
export interface ClaudeMessage {
    role: "user" | "assistant";
    content: string;
}
export interface ClaudeUsage {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
}
export interface ClaudeResponse {
    success: boolean;
    job_id: string;
    translations: Record<string, string>;
    flags?: Array<{
        key_id: string;
        reason: string;
    }>;
    usage?: ClaudeUsage;
    error?: string;
}
export interface BatchJob {
    job_id: string;
    batch_id: string;
    status: "queued" | "processing" | "succeeded" | "failed" | "expired";
    request_counts: {
        succeeded: number;
        processing: number;
        errored: number;
    };
    created_at: string;
    updated_at?: string;
    expires_at: string;
}
export interface BatchRequest {
    custom_id: string;
    params: {
        model: string;
        system: Array<{
            type: "text";
            text: string;
            cache_control?: {
                type: "ephemeral";
            };
        }>;
        messages: Array<{
            role: "user" | "assistant";
            content: string;
        }>;
        max_tokens: number;
    };
}
export interface TranslateOptions {
    sync?: boolean;
    maxWaitMs?: number;
    modelOverride?: ModelOption;
}
//# sourceMappingURL=claude.d.ts.map