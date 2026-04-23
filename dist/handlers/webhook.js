import { timingSafeEqual } from "crypto";
import { getLogger } from "../utils/logger.js";
import { recordEvent } from "../utils/event-log.js";
import { claudeClient } from "../clients/claude.js";
import { lokaliseClient } from "../clients/lokalise.js";
import { promptManager } from "../builders/prompt-manager.js";
export class WebhookHandler {
    pendingBatches = new Map();
    logger;
    getLogger() {
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
    validateSecret(received, secret) {
        if (typeof received !== "string" || typeof secret !== "string")
            return false;
        const a = Buffer.from(received);
        const b = Buffer.from(secret);
        if (a.length !== b.length)
            return false;
        return timingSafeEqual(a, b);
    }
    async handleEvent(event, context) {
        this.getLogger().debug({ eventType: event.event, eventId: context.eventId }, "Processing webhook event");
        switch (event.event) {
            case "translation.updated":
                await this.handleTranslationRequest(event, context);
                break;
            case "translation.approved":
                await this.handleTranslationApproved(event, context);
                break;
            default:
                this.getLogger().debug({ eventType: event.event, eventId: context.eventId }, "Ignoring event type");
        }
    }
    getTranslationText(key, languageIso) {
        const translation = key.translations?.find((t) => t.language_iso === languageIso);
        return translation?.translation || "";
    }
    async handleTranslationRequest(event, context) {
        try {
            if (!event.bundle.translations || event.bundle.translations.length === 0) {
                this.getLogger().warn({ eventId: context.eventId }, "No translations in bundle");
                return;
            }
            const translation = event.bundle.translations[0];
            context.targetLanguage = translation.language_iso;
            context.sourceLanguage = translation.source_language_iso || "en";
            context.keyIds = event.bundle.translations.map((t) => t.key_id);
            this.getLogger().debug({
                eventId: context.eventId,
                sourceLanguage: context.sourceLanguage,
                targetLanguage: context.targetLanguage,
                keyCount: context.keyIds.length,
            }, "Extracting translation request");
            const client = lokaliseClient();
            const allKeys = await Promise.all(context.keyIds.map((keyId) => client.getKeyWithAllTranslations(String(keyId))));
            // Build key_id -> translation_id map for the target language so we
            // can PUT updates later (Lokalise's PUT endpoint takes translation_id).
            // Also stash existing tags so we can add "AI-translated" after push.
            context.keyIdToTranslationId = {};
            context.keyIdToTags = {};
            for (const key of allKeys) {
                const t = key.translations?.find((t) => t.language_iso === context.targetLanguage);
                if (t) {
                    context.keyIdToTranslationId[String(key.key_id)] = String(t.translation_id);
                }
                context.keyIdToTags[String(key.key_id)] = key.tags ?? [];
            }
            // Get context keys (2 before, 2 after)
            const allKeysInProject = await client.listKeys({ limit: 1000 });
            const contextKeysByTargetId = new Map();
            for (const keyId of context.keyIds) {
                const index = allKeysInProject.findIndex((k) => String(k.key_id) === String(keyId));
                if (index !== -1) {
                    contextKeysByTargetId.set(keyId, {
                        before: allKeysInProject.slice(Math.max(0, index - 2), index),
                        after: allKeysInProject.slice(index + 1, Math.min(allKeysInProject.length, index + 3)),
                    });
                }
            }
            const strings = allKeys.map((key) => ({
                key_id: key.key_id,
                key_name: key.key_name,
                value: this.getTranslationText(key, context.sourceLanguage),
                string_type: undefined,
                max_char_limit: key.character_limit,
                screen_or_section: key.platforms?.[0],
            }));
            const firstKeyContextKeys = contextKeysByTargetId.get(context.keyIds[0]);
            const translationRequest = {
                target_language: context.targetLanguage,
                strings,
                context: {
                    before: firstKeyContextKeys?.before?.map((k) => ({
                        key_id: k.key_id,
                        key_name: k.key_name,
                        value: this.getTranslationText(k, context.sourceLanguage),
                    })),
                    after: firstKeyContextKeys?.after?.map((k) => ({
                        key_id: k.key_id,
                        key_name: k.key_name,
                        value: this.getTranslationText(k, context.sourceLanguage),
                    })),
                },
            };
            const promptMessages = await promptManager().buildMessages(translationRequest);
            const response = await claudeClient.translate(promptMessages);
            if ("batch_id" in response) {
                context.batchId = response.batch_id;
                this.pendingBatches.set(response.batch_id, {
                    batchId: response.batch_id,
                    context,
                    createdAt: Date.now(),
                    pollCount: 0,
                });
                this.getLogger().info({
                    eventId: context.eventId,
                    batchId: response.batch_id,
                    targetLanguage: context.targetLanguage,
                }, "Batch submitted, will poll for completion");
            }
            else {
                await this.pushResults(response, context);
            }
        }
        catch (error) {
            this.getLogger().error({
                eventId: context.eventId,
                error: error instanceof Error ? error.message : String(error),
            }, "Translation request failed");
            recordEvent("error", `Translation failed for ${context.targetLanguage}`, {
                eventId: context.eventId,
                targetLanguage: context.targetLanguage,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    async handleTranslationApproved(event, context) {
        try {
            if (!event.bundle.translations || event.bundle.translations.length === 0) {
                return;
            }
            const translation = event.bundle.translations[0];
            context.targetLanguage = translation.language_iso;
            context.sourceLanguage = translation.source_language_iso || "en";
            context.keyIds = event.bundle.translations.map((t) => t.key_id);
            this.getLogger().debug({
                eventId: context.eventId,
                targetLanguage: context.targetLanguage,
                keyIds: context.keyIds,
            }, "Translation approved, updating TM");
            // Implementation for TM updates would go here
            // For now, just log the approval
        }
        catch (error) {
            this.getLogger().error({
                eventId: context.eventId,
                error: error instanceof Error ? error.message : String(error),
            }, "Translation approval handling failed");
        }
    }
    async pushResults(response, context) {
        if (!response.success) {
            this.getLogger().error({
                eventId: context.eventId,
                error: response.error,
            }, "Claude translation failed");
            return;
        }
        try {
            for (const [keyId, translation] of Object.entries(response.translations)) {
                // Compare as strings — flag.key_id is typed as string per
                // PromptResponse, but Claude may also emit it as a number.
                const flags = response.flags?.filter((f) => String(f.key_id) === String(keyId));
                const reviewed = !flags || flags.length === 0;
                const translationId = context.keyIdToTranslationId?.[keyId];
                if (!translationId) {
                    this.getLogger().warn({
                        eventId: context.eventId,
                        keyId,
                        targetLanguage: context.targetLanguage,
                    }, "No translation_id found for key; skipping push");
                    continue;
                }
                await lokaliseClient().updateKeyTranslation(translationId, translation, reviewed);
                // Tag the key so it's visible in Lokalise that the content was
                // produced by the AI pipeline. Idempotent — only PUTs if absent.
                const existingTags = context.keyIdToTags?.[keyId] ?? [];
                await lokaliseClient().ensureKeyTag(keyId, "AI-translated", existingTags);
                this.getLogger().debug({
                    eventId: context.eventId,
                    keyId,
                    translationId,
                    reviewed,
                    flagCount: flags?.length || 0,
                }, "Translation pushed to Lokalise");
            }
            this.getLogger().info({
                eventId: context.eventId,
                targetLanguage: context.targetLanguage,
                keyCount: context.keyIds.length,
            }, "Results pushed to Lokalise");
            recordEvent("translation_pushed", `Pushed ${context.keyIds.length} key(s) → ${context.targetLanguage}`, {
                eventId: context.eventId,
                targetLanguage: context.targetLanguage,
                keyCount: context.keyIds.length,
            });
        }
        catch (error) {
            this.getLogger().error({
                eventId: context.eventId,
                error: error instanceof Error ? error.message : String(error),
            }, "Failed to push results");
            throw error;
        }
    }
    async pollPendingBatches() {
        const now = Date.now();
        for (const [batchId, pending] of this.pendingBatches) {
            try {
                pending.pollCount++;
                const status = await claudeClient.pollBatchResult(batchId);
                if (status && status.length > 0) {
                    const response = status[0];
                    await this.pushResults(response, pending.context);
                    this.pendingBatches.delete(batchId);
                    this.getLogger().info({
                        batchId,
                        targetLanguage: pending.context.targetLanguage,
                        pollCount: pending.pollCount,
                    }, "Batch completed");
                }
            }
            catch (error) {
                const age = now - pending.createdAt;
                const maxAge = 24 * 60 * 60 * 1000;
                if (age > maxAge) {
                    this.pendingBatches.delete(batchId);
                    this.getLogger().error({
                        batchId,
                        age,
                        pollCount: pending.pollCount,
                    }, "Batch expired, removing from queue");
                }
                else if (error instanceof Error) {
                    this.getLogger().warn({
                        batchId,
                        pollCount: pending.pollCount,
                        error: error.message,
                    }, "Batch poll failed, will retry");
                }
            }
        }
    }
    getPendingBatchCount() {
        return this.pendingBatches.size;
    }
}
export const webhookHandler = new WebhookHandler();
//# sourceMappingURL=webhook.js.map