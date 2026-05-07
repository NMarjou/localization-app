import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "../config/env.js";
import { getLogger } from "../utils/logger.js";
import { ClaudeError, ValidationError } from "../utils/errors.js";
import { recordCost } from "../utils/cost-log.js";
import { tolerantParse } from "../utils/json-repair.js";
const MODEL_MAP = {
    "haiku-4-5": "claude-haiku-4-5",
    "sonnet-4-6": "claude-sonnet-4-6",
};
/**
 * Tool definition that forces Claude to return its translations as a
 * structured object (Anthropic parses it for us, so JSON-syntax errors
 * are impossible). Used with tool_choice to guarantee invocation.
 */
const TRANSLATIONS_TOOL = {
    name: "submit_translations",
    description: "Return the completed translations to the caller. Call this tool exactly once. The translations object MUST contain one entry for every requested key_id — never omit a key, even if the source is ambiguous. Use flags as additive metadata to mark concerns; flags NEVER replace a translation.",
    input_schema: {
        type: "object",
        properties: {
            translations: {
                type: "object",
                description: "Map of source key_id (as a string) to the translated text in the target language. Required: one entry per requested key_id, no exceptions.",
                additionalProperties: { type: "string" },
            },
            flags: {
                type: "array",
                description: "Optional review notes. Use to signal glossary mismatches, ambiguity, cultural references, or character-limit risks. A key listed here MUST also appear in translations with your best-effort translation.",
                items: {
                    type: "object",
                    properties: {
                        key_id: { type: "string" },
                        reason: { type: "string" },
                    },
                    required: ["key_id", "reason"],
                },
            },
        },
        required: ["translations"],
    },
};
export class ClaudeMessagesClient {
    client;
    logger;
    maxRetries = 3;
    retryDelay = 1000;
    getClient() {
        if (!this.client) {
            const env = getEnv();
            this.client = new Anthropic({
                apiKey: env.ANTHROPIC_API_KEY,
            });
        }
        return this.client;
    }
    getLogger() {
        if (!this.logger) {
            this.logger = getLogger();
        }
        return this.logger;
    }
    async translate(job) {
        this.getLogger().debug({ jobId: job.job_id, model: job.model }, "Starting translation request");
        const modelId = MODEL_MAP[job.model];
        // Estimate output tokens: each translation averages ~40 tokens, minimum 2048.
        const stringCount = job.prompt_messages.messages.reduce((n, m) => {
            const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
            return n + (text.match(/"key_id"/g)?.length ?? 0);
        }, 0);
        const maxTokens = Math.max(2048, stringCount * 60);
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                // On retry, append a hard reminder. Most paths now use tool_use so
                // this only fires for the rare case where Claude emits text.
                const messages = attempt > 0
                    ? [
                        ...job.prompt_messages.messages.slice(0, -1),
                        {
                            role: "user",
                            content: (job.prompt_messages.messages.at(-1)?.content ?? "") +
                                "\n\nIMPORTANT: Use the submit_translations tool to return your output. Do not write JSON or commentary in your text response.",
                        },
                    ]
                    : job.prompt_messages.messages;
                const response = await this.getClient().messages.create({
                    model: modelId,
                    max_tokens: maxTokens,
                    system: job.prompt_messages.system,
                    messages,
                    tools: [TRANSLATIONS_TOOL],
                    tool_choice: { type: "tool", name: "submit_translations" },
                });
                const parsed = this.parseFromToolUse(response, job.job_id);
                parsed.usage = this.extractUsage(response.usage);
                // Fire-and-forget cost log (records tokens + USD attribution).
                void recordCost({
                    jobId: job.job_id,
                    projectId: job.projectId,
                    targetLanguage: job.targetLanguage,
                    model: job.model,
                    isBatch: false,
                    usage: parsed.usage,
                });
                this.getLogger().debug({
                    jobId: job.job_id,
                    translations: Object.keys(parsed.translations).length,
                    flags: parsed.flags?.length || 0,
                    usage: parsed.usage,
                }, "Translation completed");
                return parsed;
            }
            catch (error) {
                // Retry on JSON parse failures and rate limits; fail fast on everything else.
                const isParseError = error instanceof ValidationError ||
                    (error instanceof ClaudeError && error.message.includes("parse"));
                const isRateLimit = error instanceof Anthropic.RateLimitError;
                if ((isParseError || isRateLimit) && attempt < this.maxRetries) {
                    const delay = this.retryDelay * Math.pow(2, attempt);
                    this.getLogger().warn({ attempt, delay, reason: isRateLimit ? "rate_limit" : "json_parse" }, "Retrying translation");
                    await this.sleep(delay);
                    continue;
                }
                if (error instanceof ClaudeError || error instanceof ValidationError) {
                    throw error;
                }
                if (error instanceof Anthropic.RateLimitError) {
                    throw new ClaudeError("Rate limited after retries", 429);
                }
                if (error instanceof Anthropic.APIError) {
                    throw new ClaudeError(`Claude API error: ${error.message}`, error.status || 500);
                }
                if (error instanceof Error) {
                    throw new ClaudeError(`Translation failed: ${error.message}`, 500);
                }
                throw new ClaudeError("Unknown error during translation", 500);
            }
        }
        throw new ClaudeError("Translation failed after retries", 500);
    }
    /**
     * Claude occasionally emits a tool_use input where `translations` and/or
     * `flags` are JSON STRINGS rather than the structured types declared by
     * the schema. We detect that here, parse the inner JSON (with jsonrepair
     * fallback), and return a normalized PromptResponse. If the input is
     * already structured correctly, this is a pass-through.
     */
    normalizeToolInput(raw, jobId) {
        if (!raw || typeof raw !== "object")
            return null;
        const obj = raw;
        const out = {};
        let didNormalize = false;
        // translations: object preferred, string tolerated
        if (obj.translations && typeof obj.translations === "object") {
            out.translations = obj.translations;
        }
        else if (typeof obj.translations === "string") {
            try {
                const parsed = tolerantParse(obj.translations);
                out.translations = parsed.value;
                didNormalize = true;
            }
            catch (err) {
                this.getLogger().warn({ jobId, err: err instanceof Error ? err.message : String(err) }, "tool_use translations was a string we could not parse");
            }
        }
        // flags: array preferred, string tolerated
        if (Array.isArray(obj.flags)) {
            out.flags = obj.flags;
        }
        else if (typeof obj.flags === "string") {
            try {
                const parsed = tolerantParse(obj.flags);
                out.flags = parsed.value;
                didNormalize = true;
            }
            catch {
                // Ignore — flags are optional.
            }
        }
        if (didNormalize) {
            this.getLogger().info({
                jobId,
                translationCount: out.translations && typeof out.translations === "object"
                    ? Object.keys(out.translations).length
                    : 0,
            }, "Normalized double-stringified tool_use input");
        }
        return out;
    }
    /**
     * Pull the translations out of a tool_use block. Anthropic guarantees
     * the input is valid JSON parsed against our schema — no string
     * parsing needed. If the model somehow ignored tool_choice and emitted
     * text instead, fall through to parseResponse() so jsonrepair still
     * gives us a chance.
     */
    parseFromToolUse(response, jobId) {
        const toolUse = response.content.find((b) => b.type === "tool_use" && b.name === "submit_translations");
        if (toolUse) {
            const normalized = this.normalizeToolInput(toolUse.input, jobId);
            const hasTranslations = !!normalized &&
                normalized.translations &&
                typeof normalized.translations === "object" &&
                Object.keys(normalized.translations).length > 0;
            if (!hasTranslations) {
                const preview = JSON.stringify(toolUse.input ?? null).slice(0, 600);
                this.getLogger().warn({
                    jobId,
                    hasFlags: Array.isArray(normalized?.flags) && normalized.flags.length > 0,
                    inputPreview: preview,
                }, "tool_use returned without translations");
                throw new ValidationError("tool_use input missing translations");
            }
            return {
                success: true,
                job_id: jobId,
                translations: normalized.translations,
                flags: normalized.flags,
            };
        }
        // Fallback: model emitted a text block. parseResponse handles repair.
        const textBlock = response.content.find((b) => b.type === "text");
        if (textBlock) {
            this.getLogger().warn({ jobId }, "No tool_use in response; falling back to text-JSON parse");
            return this.parseResponse(textBlock.text, jobId);
        }
        throw new ClaudeError("Response had neither tool_use nor text block", 500);
    }
    parseResponse(content, jobId) {
        const cleaned = this.stripCodeFences(content);
        // Strict parse first; fall back to jsonrepair for malformed JSON
        // (unescaped quotes, truncated strings, missing commas — common
        // with Cyrillic/Greek/Thai/Arabic translations).
        let parsed;
        let repaired = false;
        try {
            const result = tolerantParse(cleaned);
            parsed = result.value;
            repaired = result.repaired;
        }
        catch (err) {
            throw new ValidationError(`Invalid JSON in Claude response: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (!parsed || !parsed.translations || typeof parsed.translations !== "object") {
            throw new ValidationError("Response missing translations object");
        }
        if (repaired) {
            this.getLogger().info({ jobId, translations: Object.keys(parsed.translations).length }, "Used jsonrepair to recover malformed Claude response");
        }
        return {
            success: true,
            job_id: jobId,
            translations: parsed.translations,
            flags: parsed.flags,
        };
    }
    /**
     * Strip markdown code fences (```json ... ``` or ``` ... ```) that
     * Claude sometimes wraps JSON responses in, despite instructions.
     * Uses string operations instead of regex to handle large responses reliably.
     */
    stripCodeFences(text) {
        const trimmed = text.trim();
        if (!trimmed.startsWith("```"))
            return trimmed;
        const firstNewline = trimmed.indexOf("\n");
        if (firstNewline === -1)
            return trimmed;
        const body = trimmed.slice(firstNewline + 1);
        const lastFence = body.lastIndexOf("```");
        return lastFence !== -1 ? body.slice(0, lastFence).trim() : body.trim();
    }
    extractUsage(usage) {
        return {
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            cache_creation_input_tokens: usage
                .cache_creation_input_tokens,
            cache_read_input_tokens: usage
                .cache_read_input_tokens,
        };
    }
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
//# sourceMappingURL=claude-messages.js.map