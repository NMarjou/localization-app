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

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.getClient().messages.create({
          model: modelId,
          max_tokens: 4096,
          system: job.prompt_messages.system,
          messages: job.prompt_messages.messages as Anthropic.MessageParam[],
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
   */
  private stripCodeFences(text: string): string {
    const trimmed = text.trim();
    const fenced = trimmed.match(
      /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i
    );
    return fenced ? fenced[1].trim() : trimmed;
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
