import express from "express";
import { getEnv } from "./config/env.js";
import { getLogger } from "./utils/logger.js";
import { webhookHandler } from "./handlers/webhook.js";
import { runBackfill } from "./handlers/backfill.js";
import { lokaliseClient } from "./clients/lokalise.js";
/**
 * Map Lokalise's real event names to the internal names the handler
 * switches on. We intentionally map "proofread" (reviewed) to the internal
 * "translation.updated" path — that is our re-translate trigger. Raw
 * value-change events (project.translation.updated) are ignored, because
 * the workflow is "edit → review → re-translate", not "edit → re-translate".
 */
const EVENT_NAME_MAP = {
    "project.translation.proofread": "translation.updated",
    "project.translation.unapproved": "translation.unapproved",
    "project.key.added": "key.added",
    "project.key.deleted": "key.removed",
    "project.language.added": "project.language_added",
    "project.language.removed": "project.language_removed",
};
/**
 * Adapt Lokalise's actual webhook payload into one or more internal events.
 *
 * Lokalise sends: { event, project: {id}, translation: {...}, key: {id},
 * language: {iso}, ... }. Behaviour:
 *
 *  - Source-language edit → fan out to one event per non-source target
 *    language (translate source → each target).
 *  - Non-source-language edit (target-language edit) → return [] so we
 *    don't overwrite human translator work or our own pushes.
 *  - Unknown event → null (caller returns 400).
 */
async function adaptLokaliseEvent(raw, sourceLanguageIso) {
    const mappedEvent = EVENT_NAME_MAP[raw?.event];
    if (!mappedEvent)
        return null;
    const projectId = raw?.project?.id;
    const keyId = raw?.key?.id;
    const editedLanguage = raw?.language?.iso;
    if (!projectId || !keyId || !editedLanguage)
        return null;
    // Only translation.updated needs fan-out logic for now. Pass approved/etc.
    // straight through using the edited language.
    if (mappedEvent !== "translation.updated") {
        return [
            {
                event: mappedEvent,
                project_id: projectId,
                bundle: {
                    translations: [
                        {
                            key_id: Number(keyId),
                            language_iso: editedLanguage,
                            words: 0,
                            source_language_iso: sourceLanguageIso,
                        },
                    ],
                },
            },
        ];
    }
    // Target-language edit: skip to avoid loops and stomping humans.
    if (editedLanguage !== sourceLanguageIso) {
        return [];
    }
    // Source edit: fan out to every non-source project language.
    const allLanguages = await lokaliseClient().listProjectLanguages();
    const targets = allLanguages.filter((l) => l !== sourceLanguageIso);
    return targets.map((target) => ({
        event: mappedEvent,
        project_id: projectId,
        bundle: {
            translations: [
                {
                    key_id: Number(keyId),
                    language_iso: target,
                    words: 0,
                    source_language_iso: sourceLanguageIso,
                },
            ],
        },
    }));
}
const env = getEnv();
const logger = getLogger();
const app = express();
// Middleware
app.use(express.json());
// Lokalise webhook paths (Lokalise UI uses /webhooks by default; we accept both).
const WEBHOOK_PATHS = new Set(["/webhook", "/webhooks"]);
// Secret-header validation middleware.
// Lokalise sends the configured secret verbatim in one of:
//   X-Secret | X-Api-Key | a custom header (configured in Lokalise UI)
// If the user picks "Custom", set WEBHOOK_HEADER_NAME in .env to match.
app.use((req, res, next) => {
    // Only enforce on POST; GET is a health probe from Lokalise's URL validator.
    if (req.method !== "POST" || !WEBHOOK_PATHS.has(req.path)) {
        return next();
    }
    // TEMP: log all incoming headers so we can see what Lokalise actually sends.
    logger.info({ path: req.path, headers: req.headers }, "Incoming webhook headers");
    const customHeader = process.env.WEBHOOK_HEADER_NAME?.toLowerCase();
    const received = (customHeader && req.headers[customHeader]) ||
        req.headers["x-secret"] ||
        req.headers["x-api-key"];
    if (!received) {
        logger.warn({ path: req.path }, "Missing webhook secret header");
        return res.status(401).json({ error: "Missing secret header" });
    }
    const isValid = webhookHandler.validateSecret(received, env.WEBHOOK_SECRET);
    if (!isValid) {
        logger.warn({ path: req.path }, "Invalid webhook secret");
        return res.status(401).json({ error: "Invalid secret" });
    }
    next();
});
// Health check endpoint
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        pendingBatches: webhookHandler.getPendingBatchCount(),
        timestamp: new Date().toISOString(),
    });
});
// Manual backfill trigger. Same logic as the (future) nightly job.
// Auth: X-Secret header with WEBHOOK_SECRET (same as webhook endpoints).
// Body (optional): { keyIds?: number[], languages?: string[], maxItems?: number }
// Returns immediately with 202 and a runId; logs show progress.
app.post("/trigger/backfill", (req, res) => {
    const received = req.headers["x-secret"] ||
        req.headers["x-api-key"];
    if (!received || !webhookHandler.validateSecret(received, env.WEBHOOK_SECRET)) {
        logger.warn({ path: req.path }, "Invalid or missing secret on backfill trigger");
        return res.status(401).json({ error: "Invalid secret" });
    }
    const body = req.body || {};
    const runId = `backfill_${Date.now()}`;
    res.status(202).json({ runId, status: "started" });
    runBackfill({
        keyIds: Array.isArray(body.keyIds) ? body.keyIds : undefined,
        languages: Array.isArray(body.languages) ? body.languages : undefined,
        maxItems: typeof body.maxItems === "number" ? body.maxItems : undefined,
    }).catch((err) => logger.error({ runId, error: err instanceof Error ? err.message : String(err) }, "Backfill run failed"));
});
// Respond 200 to any HEAD/GET probe on the webhook path so Lokalise URL
// validation passes regardless of which verb it probes with.
app.get(["/webhook", "/webhooks"], (_req, res) => {
    res.status(200).json({ status: "ok" });
});
// Webhook endpoint (accepts both /webhook and /webhooks).
app.post(["/webhook", "/webhooks"], async (req, res) => {
    const eventId = req.headers["x-lokalise-event-id"];
    // Lokalise sends a validation ping (X-Event: ping) when you save or test
    // a webhook. Respond 200 so Lokalise marks the endpoint healthy.
    const xEvent = req.headers["x-event"] || "";
    if (xEvent.toLowerCase() === "ping") {
        logger.info({ eventId }, "Lokalise ping received");
        return res.status(200).json({ status: "ok" });
    }
    try {
        // Source language isn't in Lokalise's payload; fetch it from the project.
        let sourceLanguageIso;
        try {
            sourceLanguageIso = await lokaliseClient().getBaseLanguageIso();
        }
        catch (err) {
            logger.error({ eventId, error: err instanceof Error ? err.message : String(err) }, "Failed to load project base language");
            return res.status(500).json({ error: "Could not determine source language" });
        }
        const events = await adaptLokaliseEvent(req.body, sourceLanguageIso);
        if (events === null) {
            logger.warn({ eventId, xEvent, body: req.body }, "Unrecognised or incomplete webhook event");
            return res.status(400).json({ error: "Missing required fields" });
        }
        const baseEventId = eventId || `webhook_${Date.now()}`;
        if (events.length === 0) {
            logger.info({
                eventId: baseEventId,
                editedLanguage: req.body?.language?.iso,
                sourceLanguageIso,
            }, "Ignoring non-source-language edit");
            return res.status(202).json({ eventId: baseEventId, ignored: true });
        }
        // Return 202 Accepted immediately (async processing)
        res.status(202).json({ eventId: baseEventId, fanOut: events.length });
        // Process each fanned-out event asynchronously.
        for (const event of events) {
            const target = event.bundle.translations?.[0]?.language_iso ?? "";
            const context = {
                eventId: `${baseEventId}:${target}`,
                sourceLanguage: "",
                targetLanguage: "",
                keyIds: [],
                timestamp: Date.now(),
            };
            webhookHandler
                .handleEvent(event, context)
                .catch((err) => logger.error({
                eventId: context.eventId,
                error: err instanceof Error ? err.message : String(err),
            }, "handleEvent threw"));
        }
    }
    catch (error) {
        logger.error({
            eventId,
            error: error instanceof Error ? error.message : String(error),
        }, "Webhook processing error");
        // Already sent 202, but log the error for monitoring
    }
});
// Batch polling interval (every 30 seconds)
const pollInterval = setInterval(() => {
    webhookHandler
        .pollPendingBatches()
        .catch((error) => logger.error({ error: error instanceof Error ? error.message : String(error) }, "Batch polling failed"));
}, 30 * 1000);
// Graceful shutdown
const shutdown = () => {
    logger.info("Shutting down server");
    clearInterval(pollInterval);
    server.close(() => {
        logger.info("Server closed");
        process.exit(0);
    });
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
// Start server
const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "Translation service started");
});
export { app, server };
//# sourceMappingURL=server.js.map