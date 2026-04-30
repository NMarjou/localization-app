import { getLogger } from "../utils/logger.js";
import { ValidationError } from "../utils/errors.js";
import { ClaudeMessagesClient } from "./claude-messages.js";
import { ClaudeBatchClient } from "./claude-batch.js";
import type {
  TranslationJob,
  ClaudeResponse,
  ModelOption,
  TranslateOptions,
  BackfillJob,
} from "../types/claude.js";
import type { PromptMessages } from "../types/prompt.js";

/**
 * Estimated-token threshold above which a translate() call is routed to the
 * Batch API instead of the Messages API.
 *
 * Originally set to 10K (a guess), but in practice that pushed legitimate
 * webhook chunks (e.g. languages with large glossaries) onto Batch — which
 * adds minutes-to-hours of latency, not acceptable for live edits.
 *
 * Raised to 150K so virtually all real-time webhook traffic stays on the
 * Messages API. Backfill explicitly opts into Batch via submitBackfillBatch;
 * it doesn't rely on this threshold.
 *
 * Models support 200K context; this leaves headroom.
 */
const TOKEN_LIMIT_FOR_BATCH = 150000;
const DEFAULT_MODEL: ModelOption = "haiku-4-5";

export class ClaudeClient {
  private logger?: ReturnType<typeof getLogger>;
  private messagesClient = new ClaudeMessagesClient();
  private batchClient = new ClaudeBatchClient();

  private getLogger(): ReturnType<typeof getLogger> {
    if (!this.logger) {
      this.logger = getLogger();
    }
    return this.logger;
  }

  async translate(
    prompts: PromptMessages,
    options?: TranslateOptions
  ): Promise<ClaudeResponse | { batch_id: string }> {
    const jobId = this.generateJobId();
    const model = options?.modelOverride || DEFAULT_MODEL;

    this.getLogger().debug(
      { jobId, model, sync: options?.sync },
      "Starting translation"
    );

    this.validatePrompts(prompts);

    const estimatedTokens = this.estimateTokens(prompts);
    const isBatch = estimatedTokens >= TOKEN_LIMIT_FOR_BATCH;

    const job: TranslationJob = {
      job_id: jobId,
      prompt_messages: prompts,
      model,
      estimated_tokens: estimatedTokens,
      is_batch: isBatch,
      projectId: options?.projectId,
      targetLanguage: options?.targetLanguage,
    };

    if (isBatch) {
      return this.handleBatchJob(job, options);
    } else {
      return this.messagesClient.translate(job);
    }
  }

  async pollBatchResult(
    batchId: string,
    maxWaitMs?: number
  ): Promise<ClaudeResponse[]> {
    this.getLogger().debug({ batchId }, "Polling batch result");
    return this.batchClient.pollBatchCompletion(batchId, maxWaitMs);
  }

  /** Always uses the Messages API (synchronous). Used by backfill concurrency loop. */
  async translateSync(
    prompts: PromptMessages,
    model: ModelOption = DEFAULT_MODEL,
    attribution?: { projectId?: string; targetLanguage?: string }
  ): Promise<ClaudeResponse> {
    this.validatePrompts(prompts);
    const jobId = this.generateJobId();
    const job: TranslationJob = {
      job_id: jobId,
      prompt_messages: prompts,
      model,
      estimated_tokens: this.estimateTokens(prompts),
      is_batch: false,
      projectId: attribution?.projectId,
      targetLanguage: attribution?.targetLanguage,
    };
    return this.messagesClient.translate(job);
  }

  async submitBackfillBatch(
    jobs: Array<{
      id: string;
      prompts: PromptMessages;
      model: ModelOption;
      estimatedStringCount: number;
      projectId?: string;
      targetLanguage?: string;
    }>
  ): Promise<string> {
    this.getLogger().debug({ jobCount: jobs.length }, "Submitting backfill batch");

    const translationJobs: TranslationJob[] = jobs.map(j => ({
      job_id: j.id,
      prompt_messages: j.prompts,
      model: j.model,
      estimated_tokens: j.estimatedStringCount * 60,
      is_batch: true,
      projectId: j.projectId,
      targetLanguage: j.targetLanguage,
    }));

    return this.batchClient.submitBatch(translationJobs);
  }

  async getBatchResultsIfReady(batchId: string): Promise<ClaudeResponse[] | null> {
    return this.batchClient.getBatchResultsIfReady(batchId);
  }

  private async handleBatchJob(
    job: TranslationJob,
    options?: TranslateOptions
  ): Promise<ClaudeResponse | { batch_id: string }> {
    this.getLogger().debug({ jobId: job.job_id }, "Submitting batch job");

    const batchId = await this.batchClient.submitBatch([job]);

    if (options?.sync === true) {
      const maxWait = options?.maxWaitMs || 600000;
      this.getLogger().debug(
        { jobId: job.job_id, batchId, maxWait },
        "Waiting for batch completion"
      );

      const results = await this.batchClient.pollBatchCompletion(
        batchId,
        maxWait
      );

      if (results.length === 0) {
        throw new ValidationError("Batch completed with no results");
      }

      return results[0];
    }

    return { batch_id: batchId };
  }

  private validatePrompts(prompts: PromptMessages): void {
    if (!prompts.system || prompts.system.length === 0) {
      throw new ValidationError("System prompt is required");
    }

    if (!prompts.messages || prompts.messages.length === 0) {
      throw new ValidationError("User message is required");
    }

    for (const msg of prompts.messages) {
      if (msg.role !== "user") {
        throw new ValidationError("Only user messages are supported");
      }
      if (!msg.content) {
        throw new ValidationError("Message content is required");
      }
    }
  }

  private estimateTokens(prompts: PromptMessages): number {
    let tokens = 0;

    for (const sys of prompts.system) {
      tokens += this.estimateTextTokens(sys.text);
    }

    for (const msg of prompts.messages) {
      tokens += this.estimateTextTokens(msg.content);
    }

    return tokens;
  }

  private estimateTextTokens(text: string): number {
    const wordCount = text.split(/\s+/).length;
    return Math.ceil(wordCount * 1.3);
  }

  private generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
}

export const claudeClient = new ClaudeClient();
