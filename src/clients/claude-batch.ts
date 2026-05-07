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
  BatchJob,
  BatchRequest,
  ModelOption,
} from "../types/claude.js";
import type { PromptResponse } from "../types/prompt.js";

const MODEL_MAP: Record<ModelOption, string> = {
  "haiku-4-5": "claude-haiku-4-5",
  "sonnet-4-6": "claude-sonnet-4-6",
};

/** Same tool definition the Messages client uses; forces structured output. */
const TRANSLATIONS_TOOL: Anthropic.Tool = {
  name: "submit_translations",
  description:
    "Return the completed translations to the caller. Call this tool exactly once. The translations object MUST contain one entry for every requested key_id — never omit a key, even if the source is ambiguous. Use flags as additive metadata to mark concerns; flags NEVER replace a translation.",
  input_schema: {
    type: "object",
    properties: {
      translations: {
        type: "object",
        description:
          "Map of source key_id (as a string) to the translated text in the target language. Required: one entry per requested key_id, no exceptions.",
        additionalProperties: { type: "string" },
      },
      flags: {
        type: "array",
        description:
          "Optional review notes. Use to signal glossary mismatches, ambiguity, cultural references, or character-limit risks. A key listed here MUST also appear in translations with your best-effort translation.",
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

/** Attribution metadata used by the cost log when batch results land. */
interface JobMeta {
  projectId?: string;
  targetLanguage?: string;
  model: ModelOption;
}

export class ClaudeBatchClient {
  private client?: Anthropic;
  private logger?: ReturnType<typeof getLogger>;
  /** Tracks attribution per job_id (custom_id) until the batch completes. */
  private jobMetaByCustomId = new Map<string, JobMeta>();

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

  async submitBatch(jobs: TranslationJob[]): Promise<string> {
    this.getLogger().debug({ jobCount: jobs.length }, "Submitting batch");

    const requests = this.formatBatchRequests(jobs);

    try {
      const batch = await this.getClient().beta.messages.batches.create({
        requests,
      });

      // Stash attribution per job_id so the cost log can find it when the
      // batch finishes (potentially hours later).
      for (const job of jobs) {
        this.jobMetaByCustomId.set(job.job_id, {
          projectId: job.projectId,
          targetLanguage: job.targetLanguage,
          model: job.model,
        });
      }

      this.getLogger().info(
        { batchId: batch.id, jobCount: jobs.length },
        "Batch submitted"
      );

      return batch.id;
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new ClaudeError(
          `Failed to submit batch: ${error.message}`,
          error.status || 500
        );
      }

      throw new ClaudeError(
        `Failed to submit batch: ${error instanceof Error ? error.message : String(error)}`,
        500
      );
    }
  }

  async getBatchStatus(batchId: string): Promise<BatchJob> {
    this.getLogger().debug({ batchId }, "Fetching batch status");

    try {
      const batch = await this.getClient().beta.messages.batches.retrieve(batchId);

      return {
        job_id: "",
        batch_id: batch.id,
        status: batch.processing_status as BatchJob["status"],
        request_counts: {
          succeeded: batch.request_counts.succeeded,
          processing: batch.request_counts.processing,
          errored: batch.request_counts.errored,
        },
        created_at: batch.created_at,
        updated_at: (batch as unknown as Record<string, unknown>).updated_at as
          | string
          | undefined,
        expires_at: batch.expires_at,
      };
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new ClaudeError(
          `Failed to fetch batch status: ${error.message}`,
          error.status || 500
        );
      }

      throw new ClaudeError(
        `Failed to fetch batch status: ${error instanceof Error ? error.message : String(error)}`,
        500
      );
    }
  }

  async pollBatchCompletion(
    batchId: string,
    maxWaitMs: number = 600000
  ): Promise<ClaudeResponse[]> {
    this.getLogger().debug({ batchId, maxWaitMs }, "Polling batch completion");

    const startTime = Date.now();
    const pollInterval = 10000;

    while (true) {
      const status = await this.getBatchStatus(batchId);

      // Anthropic's Batch API uses processing_status="ended" as the
      // terminal state. Older docs/clients sometimes refer to
      // "succeeded"/"failed"/"expired" — we accept all of them so the
      // poller works regardless of which surface returns the result.
      if (
        status.status === "ended" ||
        status.status === "succeeded" ||
        status.status === "failed" ||
        status.status === "expired"
      ) {
        this.getLogger().info(
          {
            batchId,
            status: status.status,
            counts: status.request_counts,
          },
          "Batch complete"
        );
        return this.parseBatchResults(batchId);
      }

      const elapsed = Date.now() - startTime;
      if (elapsed > maxWaitMs) {
        throw new ClaudeError(
          `Batch did not complete within ${maxWaitMs}ms`,
          408
        );
      }

      this.getLogger().debug(
        {
          batchId,
          status: status.status,
          elapsed,
          succeeded: status.request_counts.succeeded,
          processing: status.request_counts.processing,
        },
        "Batch still processing"
      );

      await this.sleep(pollInterval);
    }
  }

  async getBatchResultsIfReady(batchId: string): Promise<ClaudeResponse[] | null> {
    const status = await this.getBatchStatus(batchId);
    if (
      status.status === "ended" ||
      status.status === "succeeded" ||
      status.status === "failed" ||
      status.status === "expired"
    ) {
      return this.parseBatchResults(batchId);
    }
    return null;
  }

  private formatBatchRequests(
    jobs: TranslationJob[]
  ): Anthropic.Messages.BatchCreateParams.Request[] {
    return jobs.map((job) => {
      const modelId = MODEL_MAP[job.model];

      return {
        custom_id: job.job_id,
        params: {
          model: modelId,
          system: job.prompt_messages.system as Anthropic.Messages.BatchCreateParams.Request["params"]["system"],
          messages: job.prompt_messages.messages as Anthropic.Messages.BatchCreateParams.Request["params"]["messages"],
          max_tokens: 4096,
          // Force structured output — same as the synchronous Messages
          // client. Eliminates JSON-parse failures.
          tools: [TRANSLATIONS_TOOL],
          tool_choice: { type: "tool", name: "submit_translations" },
        } as Anthropic.Messages.BatchCreateParams.Request["params"],
      };
    });
  }

  private async parseBatchResults(batchId: string): Promise<ClaudeResponse[]> {
    this.getLogger().debug({ batchId }, "Parsing batch results");

    const results: ClaudeResponse[] = [];

    try {
      const resultsStream = await this.getClient().beta.messages.batches.results(batchId);

      for await (const result of resultsStream) {
        if (result.result.type === "succeeded") {
          const message = result.result.message;

          // Cost log: record attribution + usage exactly once per chunk.
          // The presence of `meta` is our "first-encounter" marker —
          // after we delete it below, subsequent re-polls (which can
          // happen if the push step fails and the batch is re-fetched)
          // skip the cost write so the log isn't inflated.
          const usage = this.extractUsage(message.usage);
          const meta = this.jobMetaByCustomId.get(result.custom_id);
          if (meta) {
            void recordCost({
              jobId: result.custom_id,
              projectId: meta.projectId,
              targetLanguage: meta.targetLanguage,
              model: meta.model,
              isBatch: true,
              usage,
            });
            this.jobMetaByCustomId.delete(result.custom_id);
          }

          try {
            // Cast to loose shape — Beta vs non-Beta message types
            // diverge nominally but the content-block shapes we read
            // (tool_use.input, text.text) are identical at runtime.
            const parsed = this.parseFromToolUse(
              message as unknown as Parameters<ClaudeBatchClient["parseFromToolUse"]>[0],
              result.custom_id
            );
            parsed.usage = usage;
            results.push(parsed);
          } catch (error) {
            this.getLogger().error(
              { customId: result.custom_id, error },
              "Failed to parse batch result"
            );
            results.push({
              success: false,
              job_id: result.custom_id,
              translations: {},
              error: error instanceof Error ? error.message : String(error),
            });
          }
        } else if (result.result.type === "errored") {
          this.getLogger().error(
            { customId: result.custom_id, error: result.result.error },
            "Batch result error"
          );
          const errorMessage = (result.result.error as unknown as { message?: string }).message || "Unknown error";
          results.push({
            success: false,
            job_id: result.custom_id,
            translations: {},
            error: errorMessage,
          });
          this.jobMetaByCustomId.delete(result.custom_id);
        }
      }

      this.getLogger().debug({ batchId, resultCount: results.length }, "Batch results parsed");
      return results;
    } catch (error) {
      throw new ClaudeError(
        `Failed to parse batch results: ${error instanceof Error ? error.message : String(error)}`,
        500
      );
    }
  }

  /**
   * Same double-string handling as the synchronous Messages client.
   * Claude occasionally produces tool_use input where translations or
   * flags arrive as JSON strings instead of structured values; parse
   * them through jsonrepair so we don't reject otherwise-valid output.
   */
  private normalizeToolInput(
    raw: unknown,
    jobId: string
  ): Partial<PromptResponse> | null {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    const out: Partial<PromptResponse> = {};
    let didNormalize = false;

    if (obj.translations && typeof obj.translations === "object") {
      out.translations = obj.translations as Record<string, string>;
    } else if (typeof obj.translations === "string") {
      try {
        const parsed = tolerantParse<Record<string, string>>(obj.translations);
        out.translations = parsed.value;
        didNormalize = true;
      } catch (err) {
        this.getLogger().warn(
          { jobId, err: err instanceof Error ? err.message : String(err) },
          "tool_use translations was a string we could not parse (batch)"
        );
      }
    }

    if (Array.isArray(obj.flags)) {
      out.flags = obj.flags as PromptResponse["flags"];
    } else if (typeof obj.flags === "string") {
      try {
        const parsed = tolerantParse<PromptResponse["flags"]>(obj.flags);
        out.flags = parsed.value;
        didNormalize = true;
      } catch {
        /* flags are optional */
      }
    }

    if (didNormalize) {
      this.getLogger().info(
        {
          jobId,
          translationCount:
            out.translations && typeof out.translations === "object"
              ? Object.keys(out.translations).length
              : 0,
        },
        "Normalized double-stringified tool_use input (batch)"
      );
    }
    return out;
  }

  /**
   * Read translations from the message's tool_use block. Anthropic
   * delivers `input` as a parsed object, so this path is JSON-safe.
   * Falls through to text-JSON parsing (with jsonrepair) for the rare
   * case Claude ignored tool_choice.
   *
   * Typed structurally because the Batch API returns BetaMessage and
   * the synchronous Messages API returns Message; their content-block
   * types diverge slightly but the shape we care about is identical.
   */
  private parseFromToolUse(
    message: { content: Array<{ type: string; [key: string]: unknown }> },
    jobId: string
  ): ClaudeResponse {
    const toolUse = message.content.find(
      (b) => b.type === "tool_use" && (b as { name?: string }).name === "submit_translations"
    ) as { type: "tool_use"; input: unknown } | undefined;

    if (toolUse) {
      const normalized = this.normalizeToolInput(toolUse.input, jobId);
      const hasTranslations =
        !!normalized &&
        normalized.translations &&
        typeof normalized.translations === "object" &&
        Object.keys(normalized.translations).length > 0;

      if (!hasTranslations) {
        const preview = JSON.stringify(toolUse.input ?? null).slice(0, 600);
        this.getLogger().warn(
          {
            jobId,
            hasFlags: Array.isArray(normalized?.flags) && normalized!.flags!.length > 0,
            inputPreview: preview,
          },
          "tool_use returned without translations (batch)"
        );
        throw new ValidationError("tool_use input missing translations");
      }

      return {
        success: true,
        job_id: jobId,
        translations: normalized!.translations as Record<string, string>,
        flags: normalized!.flags,
      };
    }

    const textBlock = message.content.find((b) => b.type === "text") as
      | { type: "text"; text: string }
      | undefined;
    if (textBlock) {
      this.getLogger().warn(
        { jobId },
        "No tool_use in batch result; falling back to text-JSON parse"
      );
      return this.parseResponse(textBlock.text, jobId);
    }

    throw new ClaudeError(
      "Batch result had neither tool_use nor text block",
      500
    );
  }

  private parseResponse(content: string, jobId: string): ClaudeResponse {
    const cleaned = this.stripCodeFences(content);
    let parsed: PromptResponse;
    let repaired = false;
    try {
      const result = tolerantParse<PromptResponse>(cleaned);
      parsed = result.value;
      repaired = result.repaired;
    } catch (err) {
      throw new ClaudeError(
        `Failed to parse result: ${err instanceof Error ? err.message : String(err)}`,
        500
      );
    }

    if (!parsed || !parsed.translations || typeof parsed.translations !== "object") {
      throw new ValidationError("Response missing translations object");
    }

    if (repaired) {
      this.getLogger().info(
        { jobId, translations: Object.keys(parsed.translations).length },
        "Used jsonrepair to recover malformed Claude batch response"
      );
    }

    return {
      success: true,
      job_id: jobId,
      translations: parsed.translations,
      flags: parsed.flags,
    };
  }

  private extractUsage(
    usage: Anthropic.Messages.Usage | undefined
  ): ClaudeUsage {
    if (!usage) {
      return { input_tokens: 0, output_tokens: 0 };
    }
    return {
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      cache_creation_input_tokens: (usage as unknown as Record<string, unknown>)
        .cache_creation_input_tokens as number | undefined,
      cache_read_input_tokens: (usage as unknown as Record<string, unknown>)
        .cache_read_input_tokens as number | undefined,
    };
  }

  private stripCodeFences(text: string): string {
    const trimmed = text.trim();
    if (!trimmed.startsWith("```")) return trimmed;
    const firstNewline = trimmed.indexOf("\n");
    if (firstNewline === -1) return trimmed;
    const body = trimmed.slice(firstNewline + 1);
    const lastFence = body.lastIndexOf("```");
    return lastFence !== -1 ? body.slice(0, lastFence).trim() : body.trim();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
