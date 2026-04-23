import { getLogger } from "../utils/logger.js";
import { lokaliseClient } from "../clients/lokalise.js";
import { webhookHandler } from "./webhook.js";
import type {
  LokaliseWebhookEvent,
  WebhookContext,
} from "../types/webhook.js";

export interface BackfillOptions {
  /** Narrow to specific key ids. Default: all reviewed source keys. */
  keyIds?: number[];
  /** Narrow to specific target languages. Default: every non-source lang. */
  languages?: string[];
  /** Cap how many (key, lang) pairs we fire. Useful for manual dry-runs. */
  maxItems?: number;
}

export interface BackfillSummary {
  runId: string;
  keysInspected: number;
  staleItems: number;
  submitted: number;
  skipped: number;
  errors: number;
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
export async function runBackfill(
  opts: BackfillOptions = {}
): Promise<BackfillSummary> {
  const logger = getLogger();
  const runId = `backfill_${Date.now()}`;
  const started = Date.now();

  const summary: BackfillSummary = {
    runId,
    keysInspected: 0,
    staleItems: 0,
    submitted: 0,
    skipped: 0,
    errors: 0,
    durationMs: 0,
  };

  logger.info({ runId, opts }, "Backfill run starting");

  const client = lokaliseClient();
  const sourceLang = await client.getBaseLanguageIso();

  // Figure out the target-language universe (project languages minus source).
  const allProjectLanguages = await client.listProjectLanguages();
  const allTargets = allProjectLanguages.filter((l) => l !== sourceLang);
  const targetLanguages = opts.languages?.length
    ? opts.languages.filter((l) => allTargets.includes(l))
    : allTargets;

  // When specific keyIds are requested, fetch each directly — the listKeys
  // endpoint pages at 1000 and specific IDs may live outside the first page.
  // Without keyIds, fall back to listKeys (note: only first 1000, add
  // pagination later if the project grows much past that).
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
    : await client.listKeys({ limit: 1000 });

  summary.keysInspected = filteredKeys.length;

  // Collect every (keyId, targetLang) pair that actually needs work.
  const workItems: Array<{ keyId: number; targetLang: string }> = [];

  for (const key of filteredKeys) {
    const source = key.translations?.find(
      (t: any) => t.language_iso === sourceLang
    );
    if (!source || !source.translation || !source.is_reviewed) {
      // No reviewed source → nothing authoritative to translate from.
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

      if (isUntranslated || isStale) {
        workItems.push({ keyId: Number(key.key_id), targetLang });
      }
    }
  }

  summary.staleItems = workItems.length;

  const limited = opts.maxItems
    ? workItems.slice(0, opts.maxItems)
    : workItems;

  logger.info(
    {
      runId,
      keysInspected: summary.keysInspected,
      staleItems: summary.staleItems,
      willSubmit: limited.length,
      targetLanguages: targetLanguages.length,
    },
    "Backfill plan built"
  );

  // Fire each stale item through the normal webhook handler. Each call
  // reuses the cached key fetch / listKeys so the overhead is minimal.
  for (const item of limited) {
    const event: LokaliseWebhookEvent = {
      event: "translation.updated",
      project_id: client.getProjectId(),
      bundle: {
        translations: [
          {
            key_id: item.keyId,
            language_iso: item.targetLang,
            words: 0,
            source_language_iso: sourceLang,
          },
        ],
      },
    };

    const context: WebhookContext = {
      eventId: `${runId}:${item.keyId}:${item.targetLang}`,
      sourceLanguage: "",
      targetLanguage: "",
      keyIds: [],
      timestamp: Date.now(),
    };

    try {
      await webhookHandler.handleEvent(event, context);
      summary.submitted++;
    } catch (err) {
      summary.errors++;
      logger.error(
        {
          runId,
          keyId: item.keyId,
          targetLang: item.targetLang,
          error: err instanceof Error ? err.message : String(err),
        },
        "Backfill item failed"
      );
    }
  }

  summary.skipped = workItems.length - limited.length;
  summary.durationMs = Date.now() - started;

  logger.info({ ...summary }, "Backfill run complete");
  return summary;
}
