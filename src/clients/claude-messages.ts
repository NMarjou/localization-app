import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "../config/env.js";
import { getLogger } from "../utils/logger.js";
import { ClaudeError, ValidationError } from "../utils/errors.js";
import type {
  TranslationJob,
  ClaudeResponse,
  ClaudeUsage,
  ModelOption,
} from "../types/claude.js";
import type { PromptResponse } from "../types/prompt.js";

const MODEL_MAP: Record<ModelOption, string> = {
  "haiku-4-5": "claude-haiku-4-5",
  "sonnet-4-6": "claude-sonnet-4-6",
};

export class ClaudeMessagesClient {
  private client?: Anthropic;
  private logger?: ReturnType<typeof getLogger>;
  private maxRetries = 3;
  private retryDelay = 1000;

  private getClient(): Anthropic {
    if (!this.client) {
      const env = getEnv();
      this.client = new Anthropic({
        apiKey: env.ANTHROPIC_API_KEY,
      });
    }
    return this.client;
  }

  private getLogger(): ReturnType<typeof getLogger> {
    if (!this.logger) {
      this.logger = getLogger();
    }
    return this.logger;
  }

  async translate(job: TranslationJob): Promise<ClaudeResponse> {
    this.getLogger().debug(
      { jobId: job.job_id, model: job.model },
      "Starting translation request"
    );

    const modelId = MODEL_MAP[job.model];

    // Estimate output tokens: each translation averages ~40 tokens, minimum 2048.
    const stringCount = job.prompt_messages.messages.reduce((n, m) => {
      const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return n + (text.match(/"key_id"/g)?.length ?? 0);
    }, 0);
    const maxTokens = Math.max(2048, stringCount * 60);

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        // On JSON parse retry, append a hard reminder to the last user message.
        const messages = attempt > 0
          ? [
              ...job.prompt_messages.messages.slice(0, -1),
              {
                role: "user" as const,
                content:
                  (job.prompt_messages.messages.at(-1)?.content ?? "") +
                  "\n\nIMPORTANT: Your previous response was not valid JSON. Return ONLY a raw JSON object. No markdown, no code fences, no explanation.",
              },
            ]
          : (job.prompt_messages.messages as Anthropic.MessageParam[]);

        const response = await this.getClient().messages.create({
          model: modelId,
          max_tokens: maxTokens,
          system: job.prompt_messages.system,
          messages,
        });

        const content = response.content[0];
        if (content.type !== "text") {
          throw new ClaudeError(
            "Expected text response from Claude API",
            500
          );
        }

        const parsed = this.parseResponse(content.text, job.job_id);
        parsed.usage = this.extractUsage(response.usage);

        this.getLogger().debug(
          {
            jobId: job.job_id,
            translations: Object.keys(parsed.translations).length,
            flags: parsed.flags?.length || 0,
            usage: parsed.usage,
          },
          "Translation completed"
        );

        return parsed;
      } catch (error) {
        // Retry on JSON parse failures and rate limits; fail fast on everything else.
        const isParseError = error instanceof ValidationError ||
          (error instanceof ClaudeError && error.message.includes("parse"));
        const isRateLimit = error instanceof Anthropic.RateLimitError;

        if ((isParseError || isRateLimit) && attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt);
          this.getLogger().warn(
            { attempt, delay, reason: isRateLimit ? "rate_limit" : "json_parse" },
            "Retrying translation"
          );
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
          throw new ClaudeError(
            `Claude API error: ${error.message}`,
            error.status || 500
          );
        }

        if (error instanceof Error) {
          throw new ClaudeError(`Translation failed: ${error.message}`, 500);
        }

        throw new ClaudeError("Unknown error during translation", 500);
      }
    }

    throw new ClaudeError("Translation failed after retries", 500);
  }

  private parseResponse(content: string, jobId: string): ClaudeResponse {
    try {
      const cleaned = this.stripCodeFences(content);
      this.validateJSON(cleaned);
      const parsed = JSON.parse(cleaned) as PromptResponse;

      if (!parsed.translations || typeof parsed.translations !== "object") {
        throw new ValidationError("Response missing translations object");
      }

      return {
        success: true,
        job_id: jobId,
        translations: parsed.translations,
        flags: parsed.flags,
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }

      throw new ClaudeError(
        `Failed to parse Claude response: ${error instanceof Error ? error.message : String(error)}`,
        500
      );
    }
  }

  private validateJSON(text: string): void {
    try {
      JSON.parse(text);
    } catch (error) {
      throw new ValidationError(
        `Invalid JSON in Claude response: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Strip markdown code fences (```json ... ``` or ``` ... ```) that
   * Claude sometimes wraps JSON responses in, despite instructions.
   * Uses string operations instead of regex to handle large responses reliably.
   */
  private stripCodeFences(text: string): string {
    const trimmed = text.trim();
    if (!trimmed.startsWith("```")) return trimmed;
    const firstNewline = trimmed.indexOf("\n");
    if (firstNewline === -1) return trimmed;
    const body = trimmed.slice(firstNewline + 1);
    const lastFence = body.lastIndexOf("```");
    return lastFence !== -1 ? body.slice(0, lastFence).trim() : body.trim();
  }

  private extractUsage(usage: Anthropic.Messages.Usage): ClaudeUsage {
    return {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_creation_input_tokens: (usage as unknown as Record<string, unknown>)
        .cache_creation_input_tokens as number | undefined,
      cache_read_input_tokens: (usage as unknown as Record<string, unknown>)
        .cache_read_input_tokens as number | undefined,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
