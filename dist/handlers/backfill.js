import { getLogger } from "../utils/logger.js";
import { recordEvent } from "../utils/event-log.js";
import { lokaliseClient } from "../clients/lokalise.js";
import { claudeClient } from "../clients/claude.js";
import { webhookHandler } from "./webhook.js";
import { promptManager } from "../builders/prompt-manager.js";
import { getAllProjects, getProject } from "../config/projects.js";
/**
 * Find keys whose en-US source has been reviewed but whose target
 * translations are either missing or older than the source, and push
 * each stale target through the normal translate pipeline.
 *
 * Used by:
 *  - POST /trigger/backfill (manual)
 *  - scheduled nightly job (later)
 *
 * Runs async: caller should kick this off and not await unless they want
 * the full summary.
 */
const backfillRunning = new Set(); // tracks running project IDs
// Max concurrent Claude calls during backfill.
const CONCURRENCY = 5;
/**
 * Run backfill for all configured projects (or a specific one via opts.projectId).
 */
export async function runBackfill(opts = {}) {
    const allProjects = opts.projectId
        ? getAllProjects().filter((p) => p.id === opts.projectId)
        : getAllProjects();
    // Skip disabled projects silently.
    const projects = allProjects.filter((p) => p.enabled !== false);
    if (allProjects.length === 0) {
        throw new Error(opts.projectId ? `Project ${opts.projectId} not found` : "No projects configured");
    }
    if (projects.length === 0) {
        getLogger().info({ projectId: opts.projectId }, "All matched projects are disabled — nothing to backfill");
        return [];
    }
    return Promise.all(projects.map((p) => runProjectBackfill(p.id, opts)));
}
async function runProjectBackfill(projectId, opts) {
    const logger = getLogger();
    if (backfillRunning.has(projectId)) {
        logger.warn({ projectId }, "Backfill already in progress for project, skipping");
        throw new Error(`Backfill already in progress for project ${projectId}`);
    }
    backfillRunning.add(projectId);
    const runId = `backfill_${Date.now()}`;
    const started = Date.now();
    const summary = {
        runId,
        keysInspected: 0,
        staleItems: 0,
        submitted: 0,
        skipped: 0,
        errors: 0,
        durationMs: 0,
    };
    try {
        logger.info({ runId, projectId, opts }, "Backfill run starting");
        recordEvent("backfill_started", "Backfill run starting", { runId, projectId, opts });
        const client = lokaliseClient(projectId);
        const sourceLang = await client.getBaseLanguageIso();
        // Figure out the target-language universe (project languages minus source).
        // Intersect with: project.languages allowlist → then opts.languages filter.
        const allProjectLanguages = await client.listProjectLanguages();
        const allTargets = allProjectLanguages.filter((l) => l !== sourceLang);
        const projectConfig = getProject(projectId);
        const projectAllowed = projectConfig?.languages;
        const afterProjectFilter = projectAllowed
            ? allTargets.filter((l) => projectAllowed.includes(l))
            : allTargets;
        const targetLanguages = opts.languages?.length
            ? opts.languages.filter((l) => afterProjectFilter.includes(l))
            : afterProjectFilter;
        const filteredKeys = opts.keyIds?.length
            ? await Promise.all(opts.keyIds.map((id) => client.getKeyWithAllTranslations(String(id)).catch((err) => {
                logger.warn({
                    runId,
                    keyId: id,
                    error: err instanceof Error ? err.message : String(err),
                }, "Backfill: key fetch failed");
                return null;
            }))).then((arr) => arr.filter((k) => !!k))
            : await client.listAllKeys();
        summary.keysInspected = filteredKeys.length;
        // Collect every (keyId, targetLang) pair that actually needs work.
        const workItems = [];
        for (const key of filteredKeys) {
            const source = key.translations?.find((t) => t.language_iso === sourceLang);
            if (!source || !source.translation || !source.is_reviewed) {
                continue;
            }
            const sourceTs = source.modified_at_timestamp ?? 0;
            for (const targetLang of targetLanguages) {
                const target = key.translations?.find((t) => t.language_iso === targetLang);
                const targetTs = target?.modified_at_timestamp ?? 0;
                const isUntranslated = !target?.translation || target.translation === "";
                const isStale = targetTs < sourceTs;
                if (isUntranslated || isStale) {
                    workItems.push({ keyId: Number(key.key_id), targetLang });
                }
            }
        }
        summary.staleItems = workItems.length;
        const limited = opts.maxItems
            ? workItems.slice(0, opts.maxItems)
            : workItems;
        // Group stale items by language
        const byLanguage = new Map();
        for (const item of limited) {
            const ids = byLanguage.get(item.targetLang) ?? [];
            ids.push(item.keyId);
            byLanguage.set(item.targetLang, ids);
        }
        logger.info({
            runId,
            keysInspected: summary.keysInspected,
            staleItems: summary.staleItems,
            willSubmit: limited.length,
            targetLanguages: byLanguage.size,
        }, "Backfill plan built");
        const keyMap = new Map(filteredKeys.map(k => [String(k.key_id), k]));
        const CHUNK_SIZE = 50;
        const chunks = [];
        for (const [targetLang, keyIds] of byLanguage) {
            const keyIdToTranslationId = {};
            const keyIdToTags = {};
            for (const keyId of keyIds) {
                const key = keyMap.get(String(keyId));
                if (!key)
                    continue;
                const t = key.translations?.find((t) => t.language_iso === targetLang);
                if (t?.translation_id) {
                    keyIdToTranslationId[String(keyId)] = String(t.translation_id);
                }
                keyIdToTags[String(keyId)] = key.tags ?? [];
            }
            for (let i = 0; i < keyIds.length; i += CHUNK_SIZE) {
                const chunkKeyIds = keyIds.slice(i, i + CHUNK_SIZE);
                const chunkKeys = chunkKeyIds.map(id => keyMap.get(String(id))).filter(Boolean);
                const strings = chunkKeys.map((key) => ({
                    key_id: key.key_id,
                    key_name: typeof key.key_name === 'object' && key.key_name !== null
                        ? (key.key_name.web ?? key.key_name.other ?? key.key_name.ios ?? String(key.key_name))
                        : String(key.key_name),
                    value: key.translations?.find((t) => t.language_iso === sourceLang)?.translation ?? '',
                    max_char_limit: key.character_limit,
                    screen_or_section: 'web',
                })).filter((s) => s.value);
                if (strings.length === 0)
                    continue;
                const pm = promptManager(projectId);
                const prompts = await pm.buildMessages({
                    target_language: targetLang,
                    strings,
                    context: {},
                });
                chunks.push({
                    prompts,
                    model: pm.getModel(),
                    targetLang,
                    keyIds: chunkKeyIds,
                    keyIdToTranslationId,
                    keyIdToTags,
                });
            }
        }
        logger.info({ runId, chunkCount: chunks.length, languages: byLanguage.size }, "Processing backfill chunks with concurrency");
        // Process chunks with bounded concurrency
        let submitted = 0;
        let errors = 0;
        for (let i = 0; i < chunks.length; i += CONCURRENCY) {
            const batch = chunks.slice(i, i + CONCURRENCY);
            await Promise.all(batch.map(async (chunk) => {
                try {
                    const response = await claudeClient.translateSync(chunk.prompts, chunk.model);
                    if (response.success) {
                        await webhookHandler.pushResults(response, {
                            eventId: `${runId}:${chunk.targetLang}:${i}`,
                            projectId,
                            sourceLanguage: sourceLang,
                            targetLanguage: chunk.targetLang,
                            keyIds: chunk.keyIds,
                            keyIdToTranslationId: chunk.keyIdToTranslationId,
                            keyIdToTags: chunk.keyIdToTags,
                            timestamp: Date.now(),
                        });
                        submitted += chunk.keyIds.length;
                    }
                    else {
                        errors++;
                        logger.error({ targetLang: chunk.targetLang, error: response.error }, "Chunk translation failed");
                    }
                }
                catch (err) {
                    errors++;
                    logger.error({ targetLang: chunk.targetLang, error: err instanceof Error ? err.message : String(err) }, "Chunk processing error");
                }
            }));
            logger.info({ runId, processed: Math.min(i + CONCURRENCY, chunks.length), total: chunks.length }, "Backfill progress");
        }
        summary.submitted = submitted;
        summary.skipped = workItems.length - limited.length;
        summary.errors = errors;
        summary.durationMs = Date.now() - started;
        logger.info(summary, "Backfill completed");
        recordEvent("backfill_completed", `Backfill done: ${submitted} keys submitted, ${errors} errors`, summary);
        return summary;
    }
    finally {
        backfillRunning.delete(projectId);
    }
}
//# sourceMappingURL=backfill.js.map