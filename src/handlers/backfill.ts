import { getLogger } from "../utils/logger.js";
import { recordEvent } from "../utils/event-log.js";
import { lokaliseClient } from "../clients/lokalise.js";
import { claudeClient } from "../clients/claude.js";
import { webhookHandler } from "./webhook.js";
import { promptManager } from "../builders/prompt-manager.js";
import { getAllProjects, getProject } from "../config/projects.js";
import type { PromptMessages } from "../types/prompt.js";
import type { ModelOption } from "../types/claude.js";

export interface BackfillOptions {
  /** Narrow to specific key ids. Default: all reviewed source keys. */
  keyIds?: number[];
  /** Narrow to specific target languages. Default: every non-source lang. */
  languages?: string[];
  /** Cap how many (key, lang) pairs we fire. Useful for manual dry-runs. */
  maxItems?: number;
  /** Target a specific project. Default: all configured projects. */
  projectId?: string;
  /**
   * If true (default), only translate keys whose source string is
   * `is_reviewed`. Set to false to also pick up unreviewed source strings —
   * useful when imported keys haven't been manually approved in Lokalise yet.
   */
  requireReviewedSource?: boolean;
  /**
   * If true, re-translate every matching key regardless of whether the
   * target is already up-to-date. Use after changing prompts/rules to
   * regenerate existing translations under the new instructions.
   *
   * Combine with `languages` and/or `keyIds` to scope the reprocessing.
   * Without scoping, force=true regenerates the entire project — that
   * can be expensive and overwrite reviewed translations, so keep it
   * narrow.
   */
  force?: boolean;
}

export interface BackfillSummary {
  runId: string;
  keysInspected: number;
  staleItems: number;
  submitted: number;
  /** Capped off by opts.maxItems. */
  skipped: number;
  errors: number;
  /** Diagnostic: how many keys were silently skipped, and why. */
  skipReasons: {
    noSourceTranslation: number;
    emptySource: number;
    notReviewed: number;
    /** Keys translated correctly for the target language already. */
    upToDate: number;
  };
  /**
   * Diagnostic: a sample of up to 20 key IDs per skip reason. Helps you
   * spot what's getting missed without grepping logs.
   */
  skipSamples: {
    noSourceTranslation: number[];
    emptySource: number[];
    notReviewed: number[];
  };
  durationMs: number;
}

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
const backfillRunning = new Set<string>(); // tracks running project IDs

// Max concurrent Claude calls during backfill.
const CONCURRENCY = 5;

/**
 * Run backfill for all configured projects (or a specific one via opts.projectId).
 */
export async function runBackfill(
  opts: BackfillOptions = {}
): Promise<BackfillSummary[]> {
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

async function runProjectBackfill(
  projectId: string,
  opts: BackfillOptions
): Promise<BackfillSummary> {
  const logger = getLogger();

  if (backfillRunning.has(projectId)) {
    logger.warn({ projectId }, "Backfill already in progress for project, skipping");
    throw new Error(`Backfill already in progress for project ${projectId}`);
  }
  backfillRunning.add(projectId);

  const runId = `backfill_${Date.now()}`;
  const started = Date.now();

  const summary: BackfillSummary = {
    runId,
    keysInspected: 0,
    staleItems: 0,
    submitted: 0,
    skipped: 0,
    errors: 0,
    skipReasons: {
      noSourceTranslation: 0,
      emptySource: 0,
      notReviewed: 0,
      upToDate: 0,
    },
    skipSamples: {
      noSourceTranslation: [],
      emptySource: [],
      notReviewed: [],
    },
    durationMs: 0,
  };

  const requireReviewedSource = opts.requireReviewedSource ?? true;

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
      ? await Promise.all(
          opts.keyIds.map((id) =>
            client.getKeyWithAllTranslations(String(id)).catch((err) => {
              logger.warn(
                {
                  runId,
                  keyId: id,
                  error: err instanceof Error ? err.message : String(err),
                },
                "Backfill: key fetch failed"
              );
              return null;
            })
          )
        ).then((arr) => arr.filter((k): k is NonNullable<typeof k> => !!k))
      : await client.listAllKeys();

    summary.keysInspected = filteredKeys.length;

    // Collect every (keyId, targetLang) pair that actually needs work.
    const workItems: Array<{ keyId: number; targetLang: string }> = [];

    const pushSample = (arr: number[], id: number) => {
      if (arr.length < 20) arr.push(id);
    };

    for (const key of filteredKeys) {
      const source = key.translations?.find(
        (t: any) => t.language_iso === sourceLang
      );

      if (!source) {
        summary.skipReasons.noSourceTranslation++;
        pushSample(summary.skipSamples.noSourceTranslation, Number(key.key_id));
        continue;
      }
      if (!source.translation) {
        summary.skipReasons.emptySource++;
        pushSample(summary.skipSamples.emptySource, Number(key.key_id));
        continue;
      }
      if (requireReviewedSource && !source.is_reviewed) {
        summary.skipReasons.notReviewed++;
        pushSample(summary.skipSamples.notReviewed, Number(key.key_id));
        continue;
      }

      const sourceTs = (source as any).modified_at_timestamp ?? 0;

      for (const targetLang of targetLanguages) {
        const target = key.translations?.find(
          (t: any) => t.language_iso === targetLang
        );

        const targetTs = (target as any)?.modified_at_timestamp ?? 0;
        const isUntranslated = !target?.translation || target.translation === "";
        const isStale = targetTs < sourceTs;

        if (opts.force || isUntranslated || isStale) {
          workItems.push({ keyId: Number(key.key_id), targetLang });
        } else {
          summary.skipReasons.upToDate++;
        }
      }
    }

    summary.staleItems = workItems.length;

    const limited = opts.maxItems
      ? workItems.slice(0, opts.maxItems)
      : workItems;

    // Group stale items by language
    const byLanguage = new Map<string, number[]>();
    for (const item of limited) {
      const ids = byLanguage.get(item.targetLang) ?? [];
      ids.push(item.keyId);
      byLanguage.set(item.targetLang, ids);
    }

    logger.info(
      {
        runId,
        keysInspected: summary.keysInspected,
        staleItems: summary.staleItems,
        willSubmit: limited.length,
        targetLanguages: byLanguage.size,
      },
      "Backfill plan built"
    );

    const keyMap = new Map(filteredKeys.map(k => [String(k.key_id), k]));
    // 25 keys per chunk: larger chunks empirically trigger more JSON parse
    // failures from Claude. Smaller chunks → more API calls but fewer
    // dropped keys.
    const CHUNK_SIZE = 25;

    // Build all chunks with their metadata
    interface ChunkJob {
      prompts: PromptMessages;
      model: ModelOption;
      targetLang: string;
      keyIds: number[];
      keyIdToTranslationId: Record<string, string>;
      keyIdToTags: Record<string, string[]>;
    }

    const chunks: ChunkJob[] = [];

    for (const [targetLang, keyIds] of byLanguage) {
      const keyIdToTranslationId: Record<string, string> = {};
      const keyIdToTags: Record<string, string[]> = {};

      for (const keyId of keyIds) {
        const key = keyMap.get(String(keyId));
        if (!key) continue;
        const t = key.translations?.find((t: any) => t.language_iso === targetLang);
        if (t?.translation_id) {
          keyIdToTranslationId[String(keyId)] = String(t.translation_id);
        }
        keyIdToTags[String(keyId)] = key.tags ?? [];
      }

      for (let i = 0; i < keyIds.length; i += CHUNK_SIZE) {
        const chunkKeyIds = keyIds.slice(i, i + CHUNK_SIZE);
        const chunkKeys = chunkKeyIds.map(id => keyMap.get(String(id))).filter(Boolean) as any[];

        const strings = chunkKeys.map((key: any) => ({
          key_id: key.key_id,
          key_name: typeof key.key_name === 'object' && key.key_name !== null
            ? (key.key_name.web ?? key.key_name.other ?? key.key_name.ios ?? String(key.key_name))
            : String(key.key_name),
          value: key.translations?.find((t: any) => t.language_iso === sourceLang)?.translation ?? '',
          max_char_limit: key.character_limit,
          screen_or_section: 'web',
        })).filter((s: any) => s.value);

        if (strings.length === 0) continue;

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

    /**
     * Build a prompt for an arbitrary subset of keyIds (used both for bulk
     * chunks and per-key fallback). Returns null if there are no usable
     * source strings.
     */
    const buildPromptForKeys = async (
      targetLang: string,
      keyIds: number[]
    ): Promise<{ prompts: PromptMessages; model: ModelOption } | null> => {
      const chunkKeys = keyIds.map(id => keyMap.get(String(id))).filter(Boolean) as any[];
      const strings = chunkKeys.map((key: any) => ({
        key_id: key.key_id,
        key_name: typeof key.key_name === 'object' && key.key_name !== null
          ? (key.key_name.web ?? key.key_name.other ?? key.key_name.ios ?? String(key.key_name))
          : String(key.key_name),
        value: key.translations?.find((t: any) => t.language_iso === sourceLang)?.translation ?? '',
        max_char_limit: key.character_limit,
        screen_or_section: 'web',
      })).filter((s: any) => s.value);

      if (strings.length === 0) return null;

      const pm = promptManager(projectId);
      const prompts = await pm.buildMessages({
        target_language: targetLang,
        strings,
        context: {},
      });
      return { prompts, model: pm.getModel() };
    };

    /**
     * Translate one specific key in isolation. Single-key responses are
     * compact and reliably parse cleanly, so this is the safety net when a
     * 25-key chunk fails after retries.
     */
    const translateOneKey = async (
      keyId: number,
      targetLang: string,
      keyIdToTranslationId: Record<string, string>,
      keyIdToTags: Record<string, string[]>
    ): Promise<boolean> => {
      try {
        const built = await buildPromptForKeys(targetLang, [keyId]);
        if (!built) {
          logger.warn({ runId, keyId, targetLang }, "Per-key fallback: no source string");
          return false;
        }
        const resp = await claudeClient.translateSync(
          built.prompts,
          built.model,
          { projectId, targetLanguage: targetLang }
        );
        if (!resp.success) {
          logger.error({ runId, keyId, targetLang, err: resp.error }, "Per-key fallback failed");
          return false;
        }
        await webhookHandler.pushResults(resp, {
          eventId: `${runId}:${targetLang}:fallback:${keyId}`,
          projectId,
          sourceLanguage: sourceLang,
          targetLanguage: targetLang,
          keyIds: [keyId],
          keyIdToTranslationId,
          keyIdToTags,
          timestamp: Date.now(),
        });
        return true;
      } catch (err) {
        logger.error(
          { runId, keyId, targetLang, error: err instanceof Error ? err.message : String(err) },
          "Per-key fallback threw"
        );
        return false;
      }
    };

    // Process chunks with bounded concurrency. On chunk-level failure
    // (after the Messages client's own 3 retries), fall back to per-key
    // calls so a single bad string doesn't drop 24 healthy ones.
    let submitted = 0;
    let errors = 0;

    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
      const batch = chunks.slice(i, i + CONCURRENCY);

      await Promise.all(batch.map(async (chunk) => {
        let chunkFailed = false;
        let chunkError: unknown;

        try {
          const response = await claudeClient.translateSync(
            chunk.prompts,
            chunk.model,
            { projectId, targetLanguage: chunk.targetLang }
          );

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
            return;
          }
          chunkFailed = true;
          chunkError = response.error;
        } catch (err) {
          chunkFailed = true;
          chunkError = err;
        }

        if (chunkFailed) {
          logger.warn(
            {
              runId,
              targetLang: chunk.targetLang,
              keyCount: chunk.keyIds.length,
              error: chunkError instanceof Error ? chunkError.message : String(chunkError),
            },
            "Chunk failed — falling back to per-key translation"
          );
          let recovered = 0;
          let stillFailed = 0;
          for (const keyId of chunk.keyIds) {
            const ok = await translateOneKey(
              keyId,
              chunk.targetLang,
              chunk.keyIdToTranslationId,
              chunk.keyIdToTags
            );
            if (ok) recovered++;
            else stillFailed++;
          }
          submitted += recovered;
          errors += stillFailed;
          logger.info(
            { runId, targetLang: chunk.targetLang, recovered, stillFailed },
            "Per-key fallback complete"
          );
        }
      }));

      logger.info({ runId, processed: Math.min(i + CONCURRENCY, chunks.length), total: chunks.length }, "Backfill progress");
    }

    summary.submitted = submitted;
    summary.skipped = workItems.length - limited.length;
    summary.errors = errors;
    summary.durationMs = Date.now() - started;

    logger.info(summary, "Backfill completed");
    recordEvent("backfill_completed", `Backfill done: ${submitted} keys submitted, ${errors} errors`, summary as unknown as Record<string, unknown>);
    return summary;
  } finally {
    backfillRunning.delete(projectId);
  }
}
