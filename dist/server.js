import express from "express";
import { getEnv } from "./config/env.js";
import { getLogger } from "./utils/logger.js";
import path from "path";
import { fileURLToPath } from "url";
import { webhookHandler } from "./handlers/webhook.js";
import { runBackfill } from "./handlers/backfill.js";
import { startScheduler } from "./scheduler.js";
import { lokaliseClient, clearAllLokaliseClients } from "./clients/lokalise.js";
import { getProject, loadProjects, resetProjectsCache, getAllProjects } from "./config/projects.js";
import { clearAllFileLoaderCaches } from "./utils/file-loader.js";
import { recentLogs, subscribeLogs } from "./utils/log-buffer.js";
import { enqueueTranslation, flush as flushQueue, getAllQueueStates, setRunBackfill, DEFAULT_COALESCE_IDLE_MS, DEFAULT_COALESCE_MAX_KEYS, } from "./utils/translation-queue.js";
import cron from "node-cron";
// Hook the translation queue into runBackfill (lazy registration avoids
// the circular import: queue → backfill → webhookHandler → queue).
setRunBackfill(runBackfill);
import { listEvents, getStartedAt, recordEvent, } from "./utils/event-log.js";
import { summarizeCosts } from "./utils/cost-log.js";
/**
 * Map Lokalise's real event names to the internal names the handler
 * switches on.
 *
 * **Only `project.translation.proofread` triggers re-translation.**
 * Plain source edits (`project.translation.updated`) and bulk imports
 * (`project.translations.updated`) do NOT auto-translate — the workflow
 * is "edit / import → proofread → translate". Imports are acknowledged
 * with 202 but produce zero fan-out events.
 *
 * For target-language proofread events, the adapter routes to
 * "translation.approved" so the TM (and optional glossary) get updated.
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
 *  - Non-source-language edit (target-language edit) → emit a single
 *    "translation.approved" event so we can append the reviewed pair to
 *    the TM. Never re-translates — protects human translator work.
 *  - Unknown event → null (caller returns 400).
 */
async function adaptLokaliseEvent(raw, sourceLanguageIso) {
    // ─── Bulk-import event ──────────────────────────────────────────
    // Fired by Lokalise when source strings arrive via a file import
    // (e.g. GitHub integration push). Behaviour depends on the project's
    // translationTriggers config:
    //   - undefined / no "import" trigger → ignored (return []).
    //     Acknowledged 202; translation only happens once a human
    //     proofreads.
    //   - "import" in triggers → fan out the source-language entries to
    //     every allowlisted target language. Server-side coalesce logic
    //     then enqueues the unique keyIds for batched translation.
    if (raw?.event === "project.translations.updated") {
        const projectId = raw?.project?.id;
        if (!projectId)
            return null;
        const project = getProject(projectId);
        const triggers = project?.translationTriggers;
        if (!triggers || !triggers.includes("import"))
            return [];
        const entries = Array.isArray(raw?.translations) ? raw.translations : [];
        const sourceEntries = entries.filter((e) => e?.language?.iso === sourceLanguageIso && e?.key?.id);
        if (sourceEntries.length === 0)
            return [];
        const allLanguages = await lokaliseClient(projectId).listProjectLanguages();
        const allowedLanguages = project?.languages;
        const targets = allLanguages.filter((l) => l !== sourceLanguageIso && (!allowedLanguages || allowedLanguages.includes(l)));
        return targets.map((target) => ({
            event: "translation.updated",
            project_id: projectId,
            bundle: {
                translations: sourceEntries.map((e) => ({
                    key_id: Number(e.key.id),
                    language_iso: target,
                    words: 0,
                    source_language_iso: sourceLanguageIso,
                })),
            },
        }));
    }
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
    // Target-language edit: don't re-translate. Emit an "approved" event
    // so the handler can append the reviewed source→target pair to the TM.
    if (editedLanguage !== sourceLanguageIso) {
        return [
            {
                event: "translation.approved",
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
    // Source edit: fan out to non-source project languages.
    // Restrict to project.languages allowlist if configured.
    const allLanguages = await lokaliseClient(projectId).listProjectLanguages();
    const projectConfig = getProject(projectId);
    const allowedLanguages = projectConfig?.languages;
    const targets = allLanguages.filter((l) => l !== sourceLanguageIso && (!allowedLanguages || allowedLanguages.includes(l)));
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
// Lokalise webhook paths.
//   /webhook            — legacy single-project endpoint (routes by body project.id)
//   /webhooks           — same, alternate spelling
//   /webhook/:projectId — per-project endpoint (preferred for multi-project setups)
//   /webhooks/:projectId
//
// The :projectId variant is authoritative: each project gets its own URL
// configured in Lokalise so the webhook secret is checked against that
// specific project. If the body also carries a project.id, it must match.
const WEBHOOK_PATH_RE = /^\/webhooks?(?:\/([^/]+))?\/?$/;
function parseWebhookPath(path) {
    const m = WEBHOOK_PATH_RE.exec(path);
    if (!m)
        return { isWebhook: false };
    return { isWebhook: true, projectIdFromPath: m[1] };
}
// Secret-header validation middleware.
// Lokalise sends the configured secret verbatim in one of:
//   X-Secret | X-Api-Key | a custom header (configured in Lokalise UI)
// We validate against the per-project secret from projects.json.
app.use((req, res, next) => {
    const { isWebhook, projectIdFromPath } = parseWebhookPath(req.path);
    // Only enforce on POST; GET is a health probe from Lokalise's URL validator.
    if (req.method !== "POST" || !isWebhook) {
        return next();
    }
    logger.info({ path: req.path, headers: req.headers }, "Incoming webhook headers");
    const customHeader = process.env.WEBHOOK_HEADER_NAME?.toLowerCase();
    const received = (customHeader && req.headers[customHeader]) ||
        req.headers["x-secret"] ||
        req.headers["x-api-key"];
    if (!received) {
        logger.warn({ path: req.path }, "Missing webhook secret header");
        return res.status(401).json({ error: "Missing secret header" });
    }
    const bodyProjectId = req.body?.project?.id
        ? String(req.body.project.id)
        : undefined;
    // If both URL and body carry a project id, they must agree. Catches
    // misconfigured webhooks pointing the wrong project at the wrong URL.
    if (projectIdFromPath && bodyProjectId && projectIdFromPath !== bodyProjectId) {
        logger.warn({ path: req.path, projectIdFromPath, bodyProjectId }, "Webhook URL projectId does not match payload project.id");
        return res
            .status(400)
            .json({ error: "URL projectId does not match payload project.id" });
    }
    const projectId = projectIdFromPath ?? bodyProjectId;
    if (projectId) {
        const project = getProject(projectId);
        if (!project) {
            logger.warn({ path: req.path, projectId }, "Unknown project in webhook");
            return res.status(401).json({ error: "Unknown project" });
        }
        if (!project.enabled) {
            logger.info({ path: req.path, projectId }, "Webhook received for disabled project — ignoring");
            return res.status(202).json({ ignored: true, reason: "project disabled" });
        }
        if (!webhookHandler.validateSecret(received, project.webhookSecret)) {
            logger.warn({ path: req.path, projectId }, "Invalid webhook secret");
            return res.status(401).json({ error: "Invalid secret" });
        }
    }
    else {
        // Fallback: validate against any known project secret (e.g. ping events with no body)
        const allProjects = loadProjects();
        const valid = allProjects.some((p) => webhookHandler.validateSecret(received, p.webhookSecret));
        if (!valid) {
            logger.warn({ path: req.path }, "Invalid webhook secret (no project id in body)");
            return res.status(401).json({ error: "Invalid secret" });
        }
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
// Status endpoint — JSON snapshot of recent events, counts, uptime.
// Consumed by the UI dashboard at /ui.
app.get("/status", (req, res) => {
    const events = listEvents(100);
    const errorsLastHour = events.filter((e) => e.type === "error" && Date.now() - e.timestamp < 3600_000).length;
    const allProjects = loadProjects();
    const queueStates = getAllQueueStates();
    const queueByProject = new Map(queueStates.map((q) => [q.projectId, q]));
    const projects = allProjects.map((p) => ({
        id: p.id,
        name: p.name,
        enabled: p.enabled,
        model: p.model ?? "haiku-4-5",
        languages: p.languages ?? null,
        translationTriggers: p.translationTriggers ?? null,
        coalesceIdleMs: p.coalesceIdleMs ?? null,
        coalesceMaxKeys: p.coalesceMaxKeys ?? null,
        scheduledFallback: p.scheduledFallback ?? null,
        queue: queueByProject.get(p.id) ?? null,
    }));
    res.json({
        startedAt: getStartedAt(),
        uptimeMs: Date.now() - getStartedAt(),
        pendingBatches: webhookHandler.getPendingBatchCount(),
        eventCount: events.length,
        errorsLastHour,
        cron: process.env.BACKFILL_CRON?.trim() || "0 */4 * * *",
        projects,
        events,
        queues: queueStates,
        queueDefaults: {
            coalesceIdleMs: DEFAULT_COALESCE_IDLE_MS,
            coalesceMaxKeys: DEFAULT_COALESCE_MAX_KEYS,
        },
    });
});
// Cost summary endpoint. Aggregates the JSONL cost log into per-project,
// per-language and per-model totals. Optional filters:
//   ?projectId=<id>       — only count this project
//   ?since=<ms-epoch>     — only entries at/after this timestamp
//   ?until=<ms-epoch>     — only entries at/before this timestamp
//
// Public read-only — no auth — because costs are local data and the
// service is typically behind a reverse proxy / ngrok already.
app.get("/cost", async (req, res) => {
    try {
        const projectId = typeof req.query.projectId === "string"
            ? req.query.projectId
            : undefined;
        const since = typeof req.query.since === "string"
            ? Number(req.query.since)
            : undefined;
        const until = typeof req.query.until === "string"
            ? Number(req.query.until)
            : undefined;
        const format = typeof req.query.format === "string"
            ? req.query.format.toLowerCase()
            : "json";
        // Resolve project IDs to names so the text view shows readable labels.
        const projectsList = loadProjects();
        const lookup = (id) => projectsList.find((p) => p.id === id)?.name ?? id;
        const summary = await summarizeCosts({ projectId, since, until }, lookup);
        if (format === "text") {
            res.type("text/plain").send(summary.formatted);
            return;
        }
        res.json(summary);
    }
    catch (err) {
        logger.error({ error: err instanceof Error ? err.message : String(err) }, "Cost summary failed");
        res.status(500).json({ error: "Failed to compute cost summary" });
    }
});
// Serve the dashboard UI (kept at repo root so no build step is needed).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.get("/ui", (_req, res) => {
    res.sendFile(path.join(__dirname, "..", "ui.html"));
});
// Manual backfill trigger. Same logic as the (future) nightly job.
// Auth: X-Secret header with WEBHOOK_SECRET (same as webhook endpoints).
// Body (optional): { keyIds?: number[], languages?: string[], maxItems?: number }
// Returns immediately with 202 and a runId; logs show progress.
app.post("/trigger/backfill", (req, res) => {
    const received = req.headers["x-secret"] ||
        req.headers["x-api-key"];
    // Validate against any configured project secret
    const allProjects = loadProjects();
    const isValid = received && allProjects.some((p) => webhookHandler.validateSecret(received, p.webhookSecret));
    if (!isValid) {
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
        projectId: typeof body.projectId === "string" ? body.projectId : undefined,
        requireReviewedSource: typeof body.requireReviewedSource === "boolean"
            ? body.requireReviewedSource
            : undefined,
        force: typeof body.force === "boolean" ? body.force : undefined,
        useBatch: typeof body.useBatch === "boolean" ? body.useBatch : undefined,
        includeStale: typeof body.includeStale === "boolean" ? body.includeStale : undefined,
    }).catch((err) => logger.error({ runId, error: err instanceof Error ? err.message : String(err) }, "Backfill run failed"));
});
/**
 * Reusable secret-check for admin endpoints. Same convention as
 * /trigger/backfill: X-Secret (or X-Api-Key) must match any configured
 * project's webhookSecret. Returns true if valid, sends 401 + returns
 * false otherwise.
 */
function checkAdminSecret(req, res) {
    const received = req.headers["x-secret"] ||
        req.headers["x-api-key"] ||
        (typeof req.query.secret === "string" ? req.query.secret : undefined);
    const allProjects = loadProjects();
    const isValid = !!received &&
        allProjects.some((p) => webhookHandler.validateSecret(received, p.webhookSecret));
    if (!isValid) {
        logger.warn({ path: req.path }, "Invalid or missing admin secret");
        res.status(401).json({ error: "Invalid secret" });
        return false;
    }
    return true;
}
/**
 * Reload projects.json + clear all in-memory loader caches without
 * restarting the server. Use after editing project config or any
 * locale file on disk.
 */
app.post("/admin/reload", (req, res) => {
    if (!checkAdminSecret(req, res))
        return;
    resetProjectsCache();
    clearAllFileLoaderCaches();
    clearAllLokaliseClients();
    const projects = loadProjects();
    // Reload the per-project scheduled-fallback crons too, so changes to
    // projects.json take effect without a process restart.
    setupQueueCrons();
    logger.info({ projectCount: projects.length }, "Admin reload: caches cleared, projects.json re-read, queue crons re-registered");
    res.json({
        status: "ok",
        projects: projects.map((p) => ({ id: p.id, name: p.name, enabled: p.enabled })),
    });
});
// Manually flush a project's translation queue (or every project's queue).
// POST /admin/queue/flush?projectId=…   → flush one project
// POST /admin/queue/flush                → flush every project with non-empty queue
app.post("/admin/queue/flush", async (req, res) => {
    if (!checkAdminSecret(req, res))
        return;
    const projectId = typeof req.query.projectId === "string"
        ? req.query.projectId
        : req.body?.projectId;
    const targets = projectId
        ? [{ id: projectId }]
        : getAllProjects().map((p) => ({ id: p.id }));
    const results = [];
    for (const t of targets) {
        const r = await flushQueue(t.id, "manual");
        results.push({
            projectId: t.id,
            flushed: !!r,
            keyCount: r ? r.keyIds.length : 0,
        });
    }
    res.json({ status: "ok", results });
});
// Read-only queue state (projectId → size, last enqueue, next flush ts).
// Same auth as the rest of the admin endpoints.
app.get("/admin/queue", (req, res) => {
    if (!checkAdminSecret(req, res))
        return;
    res.json({ queues: getAllQueueStates() });
});
/**
 * Snapshot of the most recent N log lines (default 250). Useful for the
 * UI's initial paint before SSE takes over.
 */
app.get("/admin/logs/recent", (req, res) => {
    if (!checkAdminSecret(req, res))
        return;
    const limit = Number(req.query.limit ?? 250);
    res.json({ lines: recentLogs(Number.isFinite(limit) ? limit : 250) });
});
/**
 * Server-Sent Events live tail. Emits the buffered recent lines on
 * connect, then streams every new line as it's logged.
 *
 * EventSource doesn't let us set custom headers, so the secret comes
 * via ?secret=... — same pattern as `?secret=` works on /admin/reload.
 */
app.get("/admin/logs/stream", (req, res) => {
    if (!checkAdminSecret(req, res))
        return;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering if proxied
    res.flushHeaders?.();
    // Initial snapshot so the UI has something to render immediately.
    for (const line of recentLogs(200)) {
        res.write(`data: ${JSON.stringify(line)}\n\n`);
    }
    // Periodic comment ping keeps connections alive through proxies.
    const ping = setInterval(() => {
        try {
            res.write(`: ping\n\n`);
        }
        catch {
            /* socket closed */
        }
    }, 15000);
    const unsubscribe = subscribeLogs((line) => {
        try {
            res.write(`data: ${JSON.stringify(line)}\n\n`);
        }
        catch {
            /* socket closed; cleanup happens via close handler */
        }
    });
    req.on("close", () => {
        clearInterval(ping);
        unsubscribe();
    });
});
// Respond 200 to any HEAD/GET probe on the webhook path so Lokalise URL
// validation passes regardless of which verb it probes with.
app.get(["/webhook", "/webhooks", "/webhook/:projectId", "/webhooks/:projectId"], (_req, res) => {
    res.status(200).json({ status: "ok" });
});
// Webhook endpoint. Supports four URL shapes:
//   POST /webhook
//   POST /webhooks
//   POST /webhook/:projectId    ← preferred for multi-project setups
//   POST /webhooks/:projectId
app.post(["/webhook", "/webhooks", "/webhook/:projectId", "/webhooks/:projectId"], async (req, res) => {
    const eventId = req.headers["x-lokalise-event-id"];
    // Lokalise sends a validation ping (X-Event: ping) when you save or test
    // a webhook. Respond 200 so Lokalise marks the endpoint healthy.
    const xEvent = req.headers["x-event"] || "";
    if (xEvent.toLowerCase() === "ping") {
        logger.info({ eventId }, "Lokalise ping received");
        return res.status(200).json({ status: "ok" });
    }
    try {
        // Prefer the URL param (per-project endpoint) over the body — the
        // middleware has already verified they agree if both are set.
        const incomingProjectId = req.params?.projectId ??
            (req.body?.project?.id ? String(req.body.project.id) : undefined);
        // Source language isn't in Lokalise's payload; fetch it from the project.
        let sourceLanguageIso;
        try {
            sourceLanguageIso = await lokaliseClient(incomingProjectId).getBaseLanguageIso();
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
        // ─── Coalesce mode? ─────────────────────────────────────────
        // If the project has `translationTriggers` configured AND the
        // current Lokalise event matches one of those triggers, route the
        // affected keyIds into the per-project queue instead of translating
        // immediately. The queue's debounced flush will batch them through
        // the Batch API at ~10× lower cost than per-key webhooks.
        const project = incomingProjectId ? getProject(incomingProjectId) : undefined;
        const triggers = project?.translationTriggers;
        const rawEventName = req.body?.event;
        // Source-language proofread → fan-out events all share the same key
        // ids (one event per target lang). Dedupe before enqueueing.
        const isSourceProofread = rawEventName === "project.translation.proofread" &&
            req.body?.language?.iso === sourceLanguageIso;
        const isImport = rawEventName === "project.translations.updated";
        const isEdit = rawEventName === "project.translation.updated" &&
            req.body?.language?.iso === sourceLanguageIso;
        const triggerMatch = triggers !== undefined &&
            ((isSourceProofread && triggers.includes("proofread")) ||
                (isImport && triggers.includes("import")) ||
                (isEdit && triggers.includes("edit")));
        if (triggers !== undefined && (isSourceProofread || isImport || isEdit) && !triggerMatch) {
            // Project is in coalesce mode but this event isn't a configured
            // trigger. Acknowledge silently — no immediate translation, no enqueue.
            res.status(202).json({
                eventId: baseEventId,
                coalesce: { ignored: true, reason: "not in translationTriggers" },
            });
            return;
        }
        if (triggerMatch && incomingProjectId) {
            // Collect unique source key IDs from the events and enqueue.
            const enqueuedKeyIds = new Set();
            for (const event of events) {
                if (event.event !== "translation.updated")
                    continue; // skip approvals etc.
                for (const t of event.bundle.translations ?? []) {
                    enqueuedKeyIds.add(Number(t.key_id));
                }
            }
            let lastFlushAt = 0;
            for (const keyId of enqueuedKeyIds) {
                const r = enqueueTranslation(incomingProjectId, keyId);
                if (r.flushAt)
                    lastFlushAt = r.flushAt;
            }
            logger.info({
                eventId: baseEventId,
                projectId: incomingProjectId,
                enqueuedKeys: enqueuedKeyIds.size,
                flushAt: lastFlushAt,
                trigger: rawEventName,
            }, "Enqueued for coalesced translation");
            recordEvent("webhook_completed", `Queued ${enqueuedKeyIds.size} key(s) for coalesced translation`, {
                eventId: baseEventId,
                projectId: incomingProjectId,
                enqueuedKeys: enqueuedKeyIds.size,
                flushAt: lastFlushAt,
                trigger: rawEventName,
            });
            // Still process target-language approval events (TM/glossary update).
            // Those are the events with type "translation.approved" — they bypass
            // the queue and need immediate handling so the TM stays current.
            const approvalEvents = events.filter((e) => e.event === "translation.approved");
            res.status(202).json({
                eventId: baseEventId,
                coalesce: {
                    enqueuedKeys: enqueuedKeyIds.size,
                    flushAt: lastFlushAt,
                },
                approvals: approvalEvents.length,
            });
            for (const event of approvalEvents) {
                const target = event.bundle.translations?.[0]?.language_iso ?? "";
                const context = {
                    eventId: `${baseEventId}:${target}`,
                    projectId: incomingProjectId,
                    sourceLanguage: "",
                    targetLanguage: "",
                    keyIds: [],
                    timestamp: Date.now(),
                };
                webhookHandler.handleEvent(event, context).catch((err) => logger.error({
                    eventId: context.eventId,
                    error: err instanceof Error ? err.message : String(err),
                }, "handleEvent threw (approval path)"));
            }
            return;
        }
        // ─── Legacy immediate path ─────────────────────────────────
        // Return 202 Accepted immediately (async processing)
        res.status(202).json({ eventId: baseEventId, fanOut: events.length });
        // Process each fanned-out event asynchronously.
        for (const event of events) {
            const target = event.bundle.translations?.[0]?.language_iso ?? "";
            const context = {
                eventId: `${baseEventId}:${target}`,
                projectId: incomingProjectId,
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
// Periodic backfill (default: every 4 hours, override with BACKFILL_CRON).
const scheduledBackfill = startScheduler();
// Per-project cron jobs: scheduled fallback flush of the translation queue.
// Each project that sets `scheduledFallback` (cron string) gets its own
// schedule. Flushes only fire if there's something queued, so this is a
// no-op for healthy projects; it just acts as recovery for queues stuck
// across restart or transient errors.
const queueCronJobs = [];
function setupQueueCrons() {
    // Tear down any existing crons first (called on /admin/reload too).
    while (queueCronJobs.length)
        queueCronJobs.pop()?.stop();
    for (const project of getAllProjects()) {
        if (!project.enabled)
            continue;
        const schedule = project.scheduledFallback;
        if (!schedule || typeof schedule !== "string" || schedule.trim() === "")
            continue;
        if (!cron.validate(schedule)) {
            logger.warn({ projectId: project.id, schedule }, "Invalid scheduledFallback cron expression — skipping");
            continue;
        }
        const task = cron.schedule(schedule, async () => {
            try {
                const result = await flushQueue(project.id, "scheduled");
                if (result) {
                    logger.info({ projectId: project.id, keyCount: result.keyIds.length, reason: "scheduled" }, "Scheduled queue flush ran");
                }
            }
            catch (err) {
                logger.error({ projectId: project.id, error: err instanceof Error ? err.message : String(err) }, "Scheduled queue flush threw");
            }
        });
        queueCronJobs.push(task);
        logger.info({ projectId: project.id, schedule }, "Registered queue scheduled-fallback cron");
    }
}
setupQueueCrons();
// Graceful shutdown.
// server.close() alone hangs because long-lived connections (SSE log
// stream, in-flight translate calls, batch polls) keep sockets open.
// We force-close them and add a hard deadline so the process exits
// quickly even if something is stuck.
let shuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = 5000;
const shutdown = (signal) => {
    if (shuttingDown)
        return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down server");
    clearInterval(pollInterval);
    scheduledBackfill.stop();
    while (queueCronJobs.length)
        queueCronJobs.pop()?.stop();
    // Stop accepting new connections AND drop currently-open ones.
    // closeIdleConnections / closeAllConnections were added in Node 18.2.
    if (typeof server.closeIdleConnections === "function") {
        server.closeIdleConnections();
    }
    server.close(() => {
        logger.info("Server closed cleanly");
        process.exit(0);
    });
    // Hard deadline: if anything is still hanging after N seconds, force-kill connections.
    const deadline = setTimeout(() => {
        logger.warn({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, "Shutdown deadline exceeded — forcing connection close");
        if (typeof server.closeAllConnections === "function") {
            server.closeAllConnections();
        }
        // Give the close callback one more tick, then exit anyway.
        setTimeout(() => process.exit(1), 250).unref();
    }, SHUTDOWN_TIMEOUT_MS);
    deadline.unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
// Start server
const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "Translation service started");
});
export { app, server };
//# sourceMappingURL=server.js.map