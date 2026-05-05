import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "../config/env.js";
import { getLogger } from "../utils/logger.js";
import { ClaudeError, ValidationError } from "../utils/errors.js";
import { recordCost } from "../utils/cost-log.js";
import { tolerantParse } from "../utils/json-repair.js";
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

/**
 * Tool definition that forces Claude to return its translations as a
 * structured object (Anthropic parses it for us, so JSON-syntax errors
 * are impossible). Used with tool_choice to guarantee invocation.
 */
const TRANSLATIONS_TOOL: Anthropic.Tool = {
  name: "submit_translations",
  description:
    "Return the completed translations to the caller. Always call this tool exactly once with all requested translations.",
  input_schema: {
    type: "object",
    properties: {
      translations: {
        type: "object",
        description:
          "Map of source key_id (as a string) to the translated text in the target language.",
        additionalProperties: { type: "string" },
      },
      flags: {
        type: "array",
        description:
          "Strings that need human review (glossary mismatch, ambiguity, cultural references, etc.).",
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
        // On retry, append a hard reminder. Most paths now use tool_use so
        // this only fires for the rare case where Claude emits text.
        const messages = attempt > 0
          ? [
              ...job.prompt_messages.messages.slice(0, -1),
              {
                role: "user" as const,
                content:
                  (job.prompt_messages.messages.at(-1)?.content ?? "") +
                  "\n\nIMPORTANT: Use the submit_translations tool to return your output. Do not write JSON or commentary in your text response.",
              },
            ]
          : (job.prompt_messages.messages as Anthropic.MessageParam[]);

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

  /**
   * Pull the translations out of a tool_use block. Anthropic guarantees
   * the input is valid JSON parsed against our schema — no string
   * parsing needed. If the model somehow ignored tool_choice and emitted
   * text instead, fall through to parseResponse() so jsonrepair still
   * gives us a chance.
   */
  private parseFromToolUse(
    response: Anthropic.Message,
    jobId: string
  ): ClaudeResponse {
    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && b.name === "submit_translations"
    );
    if (toolUse) {
      const input = toolUse.input as PromptResponse;
      if (!input || !input.translations || typeof input.translations !== "object") {
        throw new ValidationError("tool_use input missing translations");
      }
      return {
        success: true,
        job_id: jobId,
        translations: input.translations,
        flags: input.flags,
      };
    }

    // Fallback: model emitted a text block. parseResponse handles repair.
    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    if (textBlock) {
      this.getLogger().warn(
        { jobId },
        "No tool_use in response; falling back to text-JSON parse"
      );
      return this.parseResponse(textBlock.text, jobId);
    }

    throw new ClaudeError(
      "Response had neither tool_use nor text block",
      500
    );
  }

  private parseResponse(content: string, jobId: string): ClaudeResponse {
    const cleaned = this.stripCodeFences(content);

    // Strict parse first; fall back to jsonrepair for malformed JSON
    // (unescaped quotes, truncated strings, missing commas — common
    // with Cyrillic/Greek/Thai/Arabic translations).
    let parsed: PromptResponse;
    let repaired = false;
    try {
      const result = tolerantParse<PromptResponse>(cleaned);
      parsed = result.value;
      repaired = result.repaired;
    } catch (err) {
      throw new ValidationError(
        `Invalid JSON in Claude response: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!parsed || !parsed.translations || typeof parsed.translations !== "object") {
      throw new ValidationError("Response missing translations object");
    }

    if (repaired) {
      this.getLogger().info(
        { jobId, translations: Object.keys(parsed.translations).length },
        "Used jsonrepair to recover malformed Claude response"
      );
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
