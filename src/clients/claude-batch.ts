import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "../config/env.js";
import { getLogger } from "../utils/logger.js";
import { ClaudeError, ValidationError } from "../utils/errors.js";
import type {
  TranslationJob,
  ClaudeResponse,
  BatchJob,
  BatchRequest,
  ModelOption,
} from "../types/claude.js";
import type { PromptResponse } from "../types/prompt.js";

const MODEL_MAP: Record<ModelOption, string> = {
  "haiku-4-5": "claude-3-5-haiku-20241022",
  "sonnet-4-6": "claude-3-5-sonnet-20241022",
};

export class ClaudeBatchClient {
  private client?: Anthropic;
  private logger?: ReturnType<typeof getLogger>;

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

      if (
        status.status === "succeeded" ||
        status.status === "failed" ||
        status.status === "expired"
      ) {
        this.getLogger().info({ batchId, status: status.status }, "Batch complete");
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
        },
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
          const content = message.content[0];

          if (content.type !== "text") {
            this.getLogger().warn(
              { customId: result.custom_id },
              "Non-text response in batch"
            );
            continue;
          }

          try {
            const parsed = this.parseResponse(content.text, result.custom_id);
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

  private parseResponse(content: string, jobId: string): ClaudeResponse {
    try {
      const parsed = JSON.parse(content) as PromptResponse;

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
      throw new ClaudeError(
        `Failed to parse result: ${error instanceof Error ? error.message : String(error)}`,
        500
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
