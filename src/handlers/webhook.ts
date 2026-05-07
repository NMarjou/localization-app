import { timingSafeEqual } from "crypto";
import { Request, Response } from "express";
import { getLogger } from "../utils/logger.js";
import { recordEvent } from "../utils/event-log.js";
import { WebhookError } from "../utils/errors.js";
import { claudeClient } from "../clients/claude.js";
import { lokaliseClient } from "../clients/lokalise.js";
import { fileLoader } from "../utils/file-loader.js";
import { promptManager } from "../builders/prompt-manager.js";
import { getProject } from "../config/projects.js";
import type {
  LokaliseWebhookEvent,
  WebhookContext,
  PendingBatch,
  BackfillChunkMeta,
} from "../types/webhook.js";

export class WebhookHandler {
  private pendingBatches = new Map<string, PendingBatch>();
  private pendingBackfillBatches = new Map<string, {
    jobMeta: Map<string, BackfillChunkMeta>;
    runId: string;
    createdAt: number;
  }>();
  private logger?: ReturnType<typeof getLogger>;

  private getLogger(): ReturnType<typeof getLogger> {
    if (!this.logger) {
      this.logger = getLogger();
    }
    return this.logger;
  }

  /**
   * Lokalise webhooks authenticate by echoing a configured secret verbatim
   * in one of three headers (X-Secret, X-Api-Key, or a custom header).
   * There is no HMAC. We do a constant-time equality check against
   * WEBHOOK_SECRET.
   */
  validateSecret(received: string, secret: string): boolean {
    if (typeof received !== "string" || typeof secret !== "string") return false;
    const a = Buffer.from(received);
    const b = Buffer.from(secret);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  async handleEvent(
    event: LokaliseWebhookEvent,
    context: WebhookContext
  ): Promise<void> {
    this.getLogger().debug(
      { eventType: event.event, eventId: context.eventId },
      "Processing webhook event"
    );

    switch (event.event) {
      case "translation.updated":
        await this.handleTranslationRequest(event, context);
        break;
      case "translation.approved":
        await this.handleTranslationApproved(event, context);
        break;
      default:
        this.getLogger().debug(
          { eventType: event.event, eventId: context.eventId },
          "Ignoring event type"
        );
    }
  }

  private getTranslationText(
    key: any,
    languageIso: string
  ): string {
    const translation = key.translations?.find(
      (t: any) => t.language_iso === languageIso
    );
    return translation?.translation || "";
  }

  private async handleTranslationRequest(
    event: LokaliseWebhookEvent,
    context: WebhookContext
  ): Promise<void> {
    try {
      if (!event.bundle.translations || event.bundle.translations.length === 0) {
        this.getLogger().warn({ eventId: context.eventId }, "No translations in bundle");
        return;
      }

      const translation = event.bundle.translations[0];
      context.targetLanguage = translation.language_iso;
      context.sourceLanguage = translation.source_language_iso || "en";
      context.keyIds = event.bundle.translations.map((t) => t.key_id);

      this.getLogger().debug(
        {
          eventId: context.eventId,
          sourceLanguage: context.sourceLanguage,
          targetLanguage: context.targetLanguage,
          keyCount: context.keyIds.length,
        },
        "Extracting translation request"
      );

      const client = lokaliseClient(context.projectId);
      const allKeys = context.prefetchedKeys
        ? context.prefetchedKeys.filter((k) =>
            context.keyIds.includes(Number(k.key_id))
          )
        : await Promise.all(
            context.keyIds.map((keyId) =>
              client.getKeyWithAllTranslations(String(keyId))
            )
          );

      // Build key_id -> translation_id map for the target language so we
      // can PUT updates later (Lokalise's PUT endpoint takes translation_id).
      // Also stash existing tags so we can add "AI-translated" after push.
      context.keyIdToTranslationId = {};
      context.keyIdToTags = {};
      for (const key of allKeys) {
        const t = key.translations?.find(
          (t: any) => t.language_iso === context.targetLanguage
        );
        if (t) {
          context.keyIdToTranslationId[String(key.key_id)] = String(
            t.translation_id
          );
        }
        context.keyIdToTags[String(key.key_id)] = key.tags ?? [];
      }

      // Get context keys (2 before, 2 after) — only for single-key requests
      // (real-time webhooks). For large batches context per key isn't meaningful
      // and the extra listKeys call adds latency.
      const contextKeysByTargetId = new Map();
      if (context.keyIds.length === 1) {
        const allKeysInProject = await client.listKeys({ limit: 1000 });
        const keyId = context.keyIds[0];
        const index = allKeysInProject.findIndex((k) => String(k.key_id) === String(keyId));
        if (index !== -1) {
          contextKeysByTargetId.set(keyId, {
            before: allKeysInProject.slice(Math.max(0, index - 2), index),
            after: allKeysInProject.slice(
              index + 1,
              Math.min(allKeysInProject.length, index + 3)
            ),
          });
        }
      }

      const resolveKeyName = (raw: any): string =>
        typeof raw === "object" && raw !== null
          ? (raw.web ?? raw.other ?? raw.ios ?? raw.android ?? JSON.stringify(raw))
          : String(raw);

      const strings = allKeys.map((key) => ({
        key_id: key.key_id,
        key_name: resolveKeyName(key.key_name),
        value: this.getTranslationText(key, context.sourceLanguage),
        string_type: undefined as any,
        max_char_limit: key.character_limit,
        screen_or_section: "web",
      }));

      const firstKeyContextKeys = contextKeysByTargetId.get(context.keyIds[0]);
      const translationRequest = {
        target_language: context.targetLanguage,
        strings,
        context: {
          before: firstKeyContextKeys?.before?.map((k: any) => ({
            key_id: k.key_id,
            key_name: resolveKeyName(k.key_name),
            value: this.getTranslationText(k, context.sourceLanguage),
          })),
          after: firstKeyContextKeys?.after?.map((k: any) => ({
            key_id: k.key_id,
            key_name: resolveKeyName(k.key_name),
            value: this.getTranslationText(k, context.sourceLanguage),
          })),
        },
      };

      // Split into chunks of 25 keys to keep Claude responses small enough to
      // parse reliably. 50-key chunks empirically trigger code-fence wrapping
      // (and thus JSON parse failures) often enough that 25 is the sweet spot.
      const CHUNK_SIZE = 25;
      const allTranslations: Record<string, string> = {};
      const allFlags: any[] = [];

      for (let i = 0; i < translationRequest.strings.length; i += CHUNK_SIZE) {
        const chunk = translationRequest.strings.slice(i, i + CHUNK_SIZE);
        const chunkRequest = { ...translationRequest, strings: chunk };
        const pm = promptManager(context.projectId);
        const promptMessages = await pm.buildMessages(chunkRequest);
        const chunkResponse = await claudeClient.translate(promptMessages, {
          modelOverride: pm.getModel(),
          projectId: context.projectId,
          targetLanguage: context.targetLanguage,
        });

        if ("batch_id" in chunkResponse) {
          // Batch API path — store and stop chunking (whole request is async).
          context.batchId = chunkResponse.batch_id;
          this.pendingBatches.set(chunkResponse.batch_id, {
            batchId: chunkResponse.batch_id,
            context,
            createdAt: Date.now(),
            pollCount: 0,
          });
          this.getLogger().info(
            { eventId: context.eventId, batchId: chunkResponse.batch_id },
            "Batch submitted, will poll for completion"
          );
          return;
        }

        if (chunkResponse.success) {
          Object.assign(allTranslations, chunkResponse.translations);
          if (chunkResponse.flags) allFlags.push(...chunkResponse.flags);
        }
      }

      const response = { success: true, translations: allTranslations, flags: allFlags };
      await this.pushResults(response, context);
    } catch (error) {
      this.getLogger().error(
        {
          eventId: context.eventId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Translation request failed"
      );
      recordEvent(
        "error",
        `Translation failed for ${context.targetLanguage}`,
        {
          eventId: context.eventId,
          targetLanguage: context.targetLanguage,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  private async handleTranslationApproved(
    event: LokaliseWebhookEvent,
    context: WebhookContext
  ): Promise<void> {
    try {
      if (!event.bundle.translations || event.bundle.translations.length === 0) {
        return;
      }

      const translation = event.bundle.translations[0];
      context.targetLanguage = translation.language_iso;
      context.sourceLanguage = translation.source_language_iso || "en";
      context.keyIds = event.bundle.translations.map((t) => t.key_id);

      this.getLogger().debug(
        {
          eventId: context.eventId,
          targetLanguage: context.targetLanguage,
          keyIds: context.keyIds,
        },
        "Translation approved, updating TM"
      );

      // For each approved key, pull source + target values and append
      // the pair to locales/{targetLang}/tm.json.
      const client = lokaliseClient(context.projectId);
      for (const keyId of context.keyIds) {
        try {
          const key = await client.getKeyWithAllTranslations(String(keyId));

          const sourceText = this.getTranslationText(key, context.sourceLanguage);
          const targetText = this.getTranslationText(key, context.targetLanguage);

          if (!sourceText || !targetText) {
            this.getLogger().warn(
              {
                eventId: context.eventId,
                keyId,
                hasSource: !!sourceText,
                hasTarget: !!targetText,
              },
              "Skipping TM update: missing source or target text"
            );
            continue;
          }

          const result = await fileLoader(context.projectId).appendTranslationMemoryEntry(
            context.targetLanguage,
            { source: sourceText, target: targetText }
          );

          recordEvent(
            "translation_pushed",
            result.appended
              ? `TM updated for ${context.targetLanguage} (${result.total} entries)`
              : `TM unchanged for ${context.targetLanguage} (duplicate)`,
            {
              eventId: context.eventId,
              keyId,
              targetLanguage: context.targetLanguage,
              appended: result.appended,
              total: result.total,
            }
          );

          // Optionally also write to the project-wide glossary if the
          // project has glossaryAutoLearn enabled and the source string
          // looks like a term (short enough). Sentences only go to TM.
          const project = context.projectId
            ? getProject(context.projectId)
            : undefined;
          if (project?.glossaryAutoLearn) {
            const maxChars = project.glossaryAutoLearnMaxChars ?? 60;
            const maxWords = project.glossaryAutoLearnMaxWords ?? 8;
            const wordCount = sourceText.trim().split(/\s+/).length;
            const isTermLike =
              sourceText.length <= maxChars && wordCount <= maxWords;

            if (!isTermLike) {
              this.getLogger().debug(
                {
                  eventId: context.eventId,
                  keyId,
                  source: sourceText,
                  chars: sourceText.length,
                  words: wordCount,
                  maxChars,
                  maxWords,
                },
                "Glossary auto-learn skipped: source not term-like"
              );
            } else {
              try {
                const g = await fileLoader(
                  context.projectId
                ).appendProjectGlossaryEntry(
                  context.sourceLanguage,
                  context.targetLanguage,
                  sourceText,
                  targetText
                );
                if (g.added || g.updated) {
                  recordEvent(
                    "translation_pushed",
                    g.added
                      ? `Glossary row added for ${context.targetLanguage}`
                      : `Glossary updated for ${context.targetLanguage}`,
                    {
                      eventId: context.eventId,
                      keyId,
                      targetLanguage: context.targetLanguage,
                      added: g.added,
                      updated: g.updated,
                    }
                  );
                }
              } catch (gErr) {
                this.getLogger().warn(
                  {
                    eventId: context.eventId,
                    keyId,
                    error:
                      gErr instanceof Error ? gErr.message : String(gErr),
                  },
                  "Glossary auto-learn write failed (non-fatal)"
                );
              }
            }
          }
        } catch (err) {
          this.getLogger().error(
            {
              eventId: context.eventId,
              keyId,
              error: err instanceof Error ? err.message : String(err),
            },
            "Failed to update TM for key"
          );
        }
      }
    } catch (error) {
      this.getLogger().error(
        {
          eventId: context.eventId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Translation approval handling failed"
      );
      recordEvent("error", "TM update failed", {
        eventId: context.eventId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async pushResults(
    response: any,
    context: WebhookContext
  ): Promise<void> {
    if (!response.success) {
      this.getLogger().error(
        {
          eventId: context.eventId,
          error: response.error,
        },
        "Claude translation failed"
      );
      return;
    }

    try {
      const entries = Object.entries(response.translations);

      // Build bulk update payload
      const updates: Array<{ translationId: string; translation: string; reviewed: boolean }> = [];
      const keysNeedingTag: Array<{ keyId: string; existingTags: string[] }> = [];

      for (const [keyId, translation] of entries) {
        const flags = response.flags?.filter(
          (f: any) => String(f.key_id) === String(keyId)
        );
        const reviewed = !flags || flags.length === 0;

        const translationId = context.keyIdToTranslationId?.[keyId];
        if (!translationId) {
          this.getLogger().warn(
            { eventId: context.eventId, keyId, targetLanguage: context.targetLanguage },
            "No translation_id found for key; skipping push"
          );
          continue;
        }

        updates.push({ translationId, translation: translation as string, reviewed });
        keysNeedingTag.push({
          keyId,
          existingTags: context.keyIdToTags?.[keyId] ?? [],
        });
      }

      // Single bulk API call instead of N individual calls
      await lokaliseClient(context.projectId).bulkUpdateTranslations(updates);

      // Bulk tag update — only keys missing the tag
      await lokaliseClient(context.projectId).bulkEnsureKeyTags(keysNeedingTag, "AI-translated");

      this.getLogger().info(
        {
          eventId: context.eventId,
          targetLanguage: context.targetLanguage,
          keyCount: updates.length,
        },
        "Results pushed to Lokalise"
      );
      recordEvent(
        "translation_pushed",
        `Pushed ${updates.length} key(s) → ${context.targetLanguage}`,
        {
          eventId: context.eventId,
          targetLanguage: context.targetLanguage,
          keyCount: updates.length,
        }
      );
    } catch (error) {
      this.getLogger().error(
        {
          eventId: context.eventId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to push results"
      );
      throw error;
    }
  }

  async pollPendingBatches(): Promise<void> {
    const now = Date.now();

    for (const [batchId, pending] of this.pendingBatches) {
      try {
        pending.pollCount++;

        const status = await claudeClient.pollBatchResult(batchId);

        if (status && status.length > 0) {
          const response = status[0];
          // Always remove from the queue once results are in hand,
          // even if the push fails. Otherwise we re-fetch the same
          // results forever.
          try {
            await this.pushResults(response, pending.context);
            this.getLogger().info(
              {
                batchId,
                targetLanguage: pending.context.targetLanguage,
                pollCount: pending.pollCount,
              },
              "Batch completed"
            );
          } catch (pushErr) {
            this.getLogger().error(
              {
                batchId,
                targetLanguage: pending.context.targetLanguage,
                error: pushErr instanceof Error ? pushErr.message : String(pushErr),
              },
              "Batch push failed — dropping batch from poll queue"
            );
          } finally {
            this.pendingBatches.delete(batchId);
          }
        }
      } catch (error) {
        const age = now - pending.createdAt;
        const maxAge = 24 * 60 * 60 * 1000;

        if (age > maxAge) {
          this.pendingBatches.delete(batchId);
          this.getLogger().error(
            {
              batchId,
              age,
              pollCount: pending.pollCount,
            },
            "Batch expired, removing from queue"
          );
        } else if (error instanceof Error) {
          this.getLogger().warn(
            {
              batchId,
              pollCount: pending.pollCount,
              error: error.message,
            },
            "Batch poll failed, will retry"
          );
        }
      }
    }

    // Poll backfill batches
    for (const [batchId, pending] of this.pendingBackfillBatches) {
      try {
        const results = await claudeClient.getBatchResultsIfReady(batchId);
        if (!results) continue;

        this.getLogger().info({ batchId, resultCount: results.length }, "Backfill batch completed");

        // Process each chunk result. Wrap each push in its own try so a
        // 404 on one chunk's translation_id doesn't abort the rest of the
        // batch — and so we always reach the delete-from-pending step.
        let pushedChunks = 0;
        let failedChunks = 0;
        for (const result of results) {
          if (!result.success) continue;
          const meta = pending.jobMeta.get(result.job_id);
          if (!meta) continue;

          const context: WebhookContext = {
            eventId: `${pending.runId}:${result.job_id}`,
            // Critical: route pushResults to the chunk's actual project.
            // Without this, lokaliseClient() falls back to
            // env.LOKALISE_PROJECT_ID and PUTs translation_ids against the
            // wrong project → 404 on every key.
            projectId: meta.projectId,
            sourceLanguage: '',
            targetLanguage: meta.targetLang,
            keyIds: meta.keyIds,
            keyIdToTranslationId: meta.keyIdToTranslationId,
            keyIdToTags: meta.keyIdToTags,
            timestamp: Date.now(),
          };
          try {
            await this.pushResults(result, context);
            pushedChunks++;
          } catch (pushErr) {
            failedChunks++;
            this.getLogger().error(
              {
                batchId,
                jobId: result.job_id,
                targetLang: meta.targetLang,
                error: pushErr instanceof Error ? pushErr.message : String(pushErr),
              },
              "Push failed for one batch chunk — continuing with the rest"
            );
          }
        }

        // Always remove the batch from the pending map, even if some
        // chunks failed to push. Otherwise the next poll re-fetches the
        // same results and we'd loop forever.
        this.pendingBackfillBatches.delete(batchId);
        recordEvent(
          'backfill_completed',
          `Backfill batch processed: ${pushedChunks} pushed, ${failedChunks} failed (${results.length} total)`,
          { batchId, runId: pending.runId, pushedChunks, failedChunks }
        );
      } catch (err) {
        const age = Date.now() - pending.createdAt;
        if (age > 24 * 60 * 60 * 1000) {
          this.pendingBackfillBatches.delete(batchId);
          this.getLogger().error({ batchId }, "Backfill batch expired");
        } else {
          this.getLogger().warn({ batchId, error: err instanceof Error ? err.message : String(err) }, "Backfill batch poll failed, will retry");
        }
      }
    }
  }

  registerBackfillBatch(
    batchId: string,
    jobMeta: Map<string, BackfillChunkMeta>,
    runId: string
  ): void {
    this.pendingBackfillBatches.set(batchId, { jobMeta, runId, createdAt: Date.now() });
    this.getLogger().info({ batchId, runId, chunks: jobMeta.size }, "Backfill batch registered for polling");
  }

  getPendingBatchCount(): number {
    return this.pendingBatches.size;
  }
}

export const webhookHandler = new WebhookHandler();
