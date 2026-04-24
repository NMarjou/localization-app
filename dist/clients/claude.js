import { getLogger } from "../utils/logger.js";
import { ValidationError } from "../utils/errors.js";
import { ClaudeMessagesClient } from "./claude-messages.js";
import { ClaudeBatchClient } from "./claude-batch.js";
const TOKEN_LIMIT_FOR_BATCH = 10000;
const DEFAULT_MODEL = "haiku-4-5";
export class ClaudeClient {
    logger;
    messagesClient = new ClaudeMessagesClient();
    batchClient = new ClaudeBatchClient();
    getLogger() {
        if (!this.logger) {
            this.logger = getLogger();
        }
        return this.logger;
    }
    async translate(prompts, options) {
        const jobId = this.generateJobId();
        const model = options?.modelOverride || DEFAULT_MODEL;
        this.getLogger().debug({ jobId, model, sync: options?.sync }, "Starting translation");
        this.validatePrompts(prompts);
        const estimatedTokens = this.estimateTokens(prompts);
        const isBatch = estimatedTokens >= TOKEN_LIMIT_FOR_BATCH;
        const job = {
            job_id: jobId,
            prompt_messages: prompts,
            model,
            estimated_tokens: estimatedTokens,
            is_batch: isBatch,
        };
        if (isBatch) {
            return this.handleBatchJob(job, options);
        }
        else {
            return this.messagesClient.translate(job);
        }
    }
    async pollBatchResult(batchId, maxWaitMs) {
        this.getLogger().debug({ batchId }, "Polling batch result");
        return this.batchClient.pollBatchCompletion(batchId, maxWaitMs);
    }
    /** Always uses the Messages API (synchronous). Used by backfill concurrency loop. */
    async translateSync(prompts, model = DEFAULT_MODEL) {
        this.validatePrompts(prompts);
        const jobId = this.generateJobId();
        const job = {
            job_id: jobId,
            prompt_messages: prompts,
            model,
            estimated_tokens: this.estimateTokens(prompts),
            is_batch: false,
        };
        return this.messagesClient.translate(job);
    }
    async submitBackfillBatch(jobs) {
        this.getLogger().debug({ jobCount: jobs.length }, "Submitting backfill batch");
        const translationJobs = jobs.map(j => ({
            job_id: j.id,
            prompt_messages: j.prompts,
            model: j.model,
            estimated_tokens: j.estimatedStringCount * 60,
            is_batch: true,
        }));
        return this.batchClient.submitBatch(translationJobs);
    }
    async getBatchResultsIfReady(batchId) {
        return this.batchClient.getBatchResultsIfReady(batchId);
    }
    async handleBatchJob(job, options) {
        this.getLogger().debug({ jobId: job.job_id }, "Submitting batch job");
        const batchId = await this.batchClient.submitBatch([job]);
        if (options?.sync === true) {
            const maxWait = options?.maxWaitMs || 600000;
            this.getLogger().debug({ jobId: job.job_id, batchId, maxWait }, "Waiting for batch completion");
            const results = await this.batchClient.pollBatchCompletion(batchId, maxWait);
            if (results.length === 0) {
                throw new ValidationError("Batch completed with no results");
            }
            return results[0];
        }
        return { batch_id: batchId };
    }
    validatePrompts(prompts) {
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
    estimateTokens(prompts) {
        let tokens = 0;
        for (const sys of prompts.system) {
            tokens += this.estimateTextTokens(sys.text);
        }
        for (const msg of prompts.messages) {
            tokens += this.estimateTextTokens(msg.content);
        }
        return tokens;
    }
    estimateTextTokens(text) {
        const wordCount = text.split(/\s+/).length;
        return Math.ceil(wordCount * 1.3);
    }
    generateJobId() {
        return `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    }
}
export const claudeClient = new ClaudeClient();
//# sourceMappingURL=claude.js.map