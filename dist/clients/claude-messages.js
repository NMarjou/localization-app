import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "../config/env.js";
import { getLogger } from "../utils/logger.js";
import { ClaudeError, ValidationError } from "../utils/errors.js";
const MODEL_MAP = {
    "haiku-4-5": "claude-3-5-haiku-20241022",
    "sonnet-4-6": "claude-3-5-sonnet-20241022",
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
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                const response = await this.getClient().messages.create({
                    model: modelId,
                    max_tokens: 4096,
                    system: job.prompt_messages.system,
                    messages: job.prompt_messages.messages,
                });
                const content = response.content[0];
                if (content.type !== "text") {
                    throw new ClaudeError("Expected text response from Claude API", 500);
                }
                const parsed = this.parseResponse(content.text, job.job_id);
                parsed.usage = this.extractUsage(response.usage);
                this.getLogger().debug({
                    jobId: job.job_id,
                    translations: Object.keys(parsed.translations).length,
                    flags: parsed.flags?.length || 0,
                    usage: parsed.usage,
                }, "Translation completed");
                return parsed;
            }
            catch (error) {
                if (error instanceof ClaudeError) {
                    throw error;
                }
                if (error instanceof Anthropic.RateLimitError) {
                    if (attempt < this.maxRetries) {
                        const delay = this.retryDelay * Math.pow(2, attempt);
                        this.getLogger().warn({ attempt, delay }, "Rate limited, retrying");
                        await this.sleep(delay);
                        continue;
                    }
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
    parseResponse(content, jobId) {
        try {
            this.validateJSON(content);
            const parsed = JSON.parse(content);
            if (!parsed.translations || typeof parsed.translations !== "object") {
                throw new ValidationError("Response missing translations object");
            }
            return {
                success: true,
                job_id: jobId,
                translations: parsed.translations,
                flags: parsed.flags,
            };
        }
        catch (error) {
            if (error instanceof ValidationError) {
                throw error;
            }
            throw new ClaudeError(`Failed to parse Claude response: ${error instanceof Error ? error.message : String(error)}`, 500);
        }
    }
    validateJSON(text) {
        try {
            JSON.parse(text);
        }
        catch (error) {
            throw new ValidationError(`Invalid JSON in Claude response: ${error instanceof Error ? error.message : String(error)}`);
        }
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