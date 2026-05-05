import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { getLogger } from "./logger.js";

export interface TranslationMemoryEntry {
  source: string;
  target: string;
}

/**
 * Try the full locale code first (e.g. "fr_FR"), then fall back to the
 * base language ("fr"). Handles:
 *   - region separators "-" and "_": "fr-FR" / "fr_FR" → also "fr"
 *   - custom-prefix codes with dots (Lokalise convention):
 *       "translations.nl"     → also "nl"
 *       "translations.nl-NL"  → also "nl-NL", "nl"
 */
function candidateDirs(language: string): string[] {
  const candidates = new Set<string>();
  candidates.add(language);

  // Strip a custom prefix delimited by "." (Lokalise lets users define
  // arbitrary language codes like "translations.nl").
  const afterLastDot = language.includes(".")
    ? language.slice(language.lastIndexOf(".") + 1)
    : language;
  if (afterLastDot && afterLastDot !== language) candidates.add(afterLastDot);

  // Strip region from the (de-prefixed) code.
  const base = afterLastDot.split(/[-_]/)[0];
  if (base && base !== afterLastDot) candidates.add(base);

  return [...candidates];
}

/**
 * On-disk shape of a project-wide glossary at
 *   locales/<projectId>/glossary.json
 * Each entry is one term with translations keyed by language code (full
 * form like "fr-FR", base form like "fr", or a Lokalise custom code like
 * "translations.fr"). The runtime resolves the right column for the
 * requested language using the same fallback as folder lookups.
 */
export interface ProjectGlossary {
  /** Language code under which the source term lives. Default: "en". */
  source?: string;
  terms: Array<Record<string, string>>;
}

export class FileLoader {
  private logger = getLogger();
  private glossaryCache: Map<string, Record<string, string>> = new Map();
  private tmCache: Map<string, TranslationMemoryEntry[]> = new Map();
  private styleGuideCache: Map<string, string> = new Map();
  /** Cache for the project-wide master glossary (loaded once per projectId). */
  private projectGlossaryCache?: ProjectGlossary | null;
  private projectId?: string;

  constructor(projectId?: string) {
    this.projectId = projectId;
  }

  /**
   * Returns candidate base directories to search for locale files.
   *
   * When a projectId is set, ONLY the project-namespaced path is searched
   * (locales/{projectId}/{lang}). A misconfigured projectId fails loud rather
   * than silently leaking template data.
   *
   * When no projectId is set (legacy single-project mode without
   * projects.json), the flat locales/{lang} layout is used. The
   * locales/_template/{lang} folder is the seed copied to a new project's
   * namespace via scripts/seed-project-locales.mjs and is never read at
   * runtime.
   */
  private baseDirs(language: string): string[] {
    const dirs: string[] = [];
    for (const lang of candidateDirs(language)) {
      if (this.projectId) {
        dirs.push(join(process.cwd(), "locales", this.projectId, lang));
      } else {
        dirs.push(join(process.cwd(), "locales", lang));
      }
    }
    return dirs;
  }

  /**
   * Load the project-wide master glossary at
   * locales/<projectId>/glossary.json. Cached after first read; same
   * instance is shared across all languages. Returns null if no file
   * (so legacy per-language glossaries still work).
   */
  private async loadProjectGlossary(): Promise<ProjectGlossary | null> {
    if (this.projectGlossaryCache !== undefined) {
      return this.projectGlossaryCache;
    }
    if (!this.projectId) {
      this.projectGlossaryCache = null;
      return null;
    }
    const filePath = join(process.cwd(), "locales", this.projectId, "glossary.json");
    try {
      const content = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(content);
      // Tolerate two shapes: { source, terms } or a bare array of terms.
      if (Array.isArray(parsed)) {
        this.projectGlossaryCache = { source: "en", terms: parsed };
      } else if (parsed && Array.isArray(parsed.terms)) {
        this.projectGlossaryCache = parsed as ProjectGlossary;
      } else {
        // Legacy {source: target} object isn't a project-wide glossary.
        this.projectGlossaryCache = null;
      }
      this.logger.debug(
        {
          filePath,
          terms: this.projectGlossaryCache?.terms.length ?? 0,
        },
        "Project-wide glossary loaded"
      );
      return this.projectGlossaryCache;
    } catch {
      this.projectGlossaryCache = null;
      return null;
    }
  }

  async loadGlossary(language: string): Promise<Record<string, string>> {
    const cacheKey = `glossary:${language}`;

    if (this.glossaryCache.has(cacheKey)) {
      this.logger.debug({ language }, "Returning cached glossary");
      return this.glossaryCache.get(cacheKey)!;
    }

    // 1. Prefer the project-wide master glossary (single source of truth).
    const master = await this.loadProjectGlossary();
    if (master && master.terms.length > 0) {
      const sourceCandidates = candidateDirs(master.source ?? "en");
      const targetCandidates = candidateDirs(language);
      const projected: Record<string, string> = {};
      for (const term of master.terms) {
        // Find source value: try each candidate code until one hits
        let source: string | undefined;
        for (const code of sourceCandidates) {
          if (typeof term[code] === "string" && term[code]) {
            source = term[code];
            break;
          }
        }
        if (!source) continue;
        // Find target value
        let target: string | undefined;
        for (const code of targetCandidates) {
          if (typeof term[code] === "string" && term[code]) {
            target = term[code];
            break;
          }
        }
        if (target) projected[source.trim()] = target.trim();
      }
      this.glossaryCache.set(cacheKey, projected);
      this.logger.debug(
        { language, terms: Object.keys(projected).length, source: "project-wide" },
        "Glossary projected for language"
      );
      return projected;
    }

    // 2. Fall back to legacy per-language file at locales/<projectId>/<lang>/glossary.json.
    for (const dir of this.baseDirs(language)) {
      try {
        const filePath = join(dir, "glossary.json");
        const content = await readFile(filePath, "utf-8");
        const glossary = JSON.parse(content) as Record<string, string>;
        // Skip empty stubs ({})
        if (!glossary || Object.keys(glossary).length === 0) continue;
        this.glossaryCache.set(cacheKey, glossary);
        this.logger.debug(
          { language, dir, terms: Object.keys(glossary).length, source: "per-language" },
          "Glossary loaded"
        );
        return glossary;
      } catch {
        // Try next candidate
      }
    }

    this.logger.debug(
      { language },
      "No glossary found; returning empty"
    );
    this.glossaryCache.set(cacheKey, {});
    return {};
  }

  async loadTranslationMemory(
    language: string
  ): Promise<TranslationMemoryEntry[]> {
    const cacheKey = `tm:${language}`;

    if (this.tmCache.has(cacheKey)) {
      this.logger.debug({ language }, "Returning cached translation memory");
      return this.tmCache.get(cacheKey)!;
    }

    for (const dir of this.baseDirs(language)) {
      try {
        const filePath = join(dir, "tm.json");
        this.logger.debug({ filePath }, "Loading translation memory from file");

        const content = await readFile(filePath, "utf-8");
        const tm = JSON.parse(content) as TranslationMemoryEntry[];

        this.tmCache.set(cacheKey, tm);
        this.logger.debug(
          { language, dir, entries: tm.length },
          "Translation memory loaded"
        );

        return tm;
      } catch {
        // Try next candidate
      }
    }

    // Missing TM is a legitimate runtime state (project hasn't built one
    // yet, or this language isn't curated). Don't spam warn; debug is enough.
    this.logger.debug(
      { language, tried: this.baseDirs(language) },
      "No translation memory found, returning empty"
    );
    this.tmCache.set(cacheKey, []);
    return [];
  }

  /**
   * Pick the column key to use when writing into the project-wide glossary
   * for a given Lokalise language code. Prefers a key form that already
   * exists in the file (so new appends stay consistent with imported rows).
   * Falls back to base ISO 639-1.
   */
  private pickGlossaryColumnKey(
    doc: ProjectGlossary,
    langCode: string
  ): string {
    const noPrefix = langCode.includes(".")
      ? langCode.split(".").pop() ?? langCode
      : langCode;
    const base = noPrefix.split(/[-_]/)[0];
    const candidates = Array.from(new Set([langCode, noPrefix, base]));

    for (const row of doc.terms) {
      for (const c of candidates) {
        if (c in row) return c;
      }
    }
    return base;
  }

  /**
   * Append (or update) a single source/target pair in the project-wide
   * glossary at locales/<projectId>/glossary.json.
   *
   * - If a row with `source` in the source column already exists, set its
   *   target-language column to `target`. Returns updated=true.
   * - If no such row exists, create a new row with just source + target.
   *   Returns added=true.
   * - If the row already has identical target, no-op (added/updated both
   *   false).
   *
   * Used by `handleTranslationApproved` when glossaryAutoLearn is enabled.
   */
  async appendProjectGlossaryEntry(
    sourceLanguage: string,
    targetLanguage: string,
    source: string,
    target: string
  ): Promise<{ added: boolean; updated: boolean }> {
    if (!this.projectId) {
      throw new Error("appendProjectGlossaryEntry requires projectId");
    }
    const sourceTrimmed = source.trim();
    const targetTrimmed = target.trim();
    if (!sourceTrimmed || !targetTrimmed) {
      throw new Error("source and target must be non-empty");
    }

    const filePath = join(
      process.cwd(),
      "locales",
      this.projectId,
      "glossary.json"
    );

    let doc: ProjectGlossary;
    if (existsSync(filePath)) {
      const content = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        doc = { source: "en", terms: parsed };
      } else if (parsed && Array.isArray(parsed.terms)) {
        doc = parsed as ProjectGlossary;
      } else {
        // Legacy shape (per-language object) — start a fresh project-wide doc.
        doc = { source: undefined, terms: [] };
      }
    } else {
      await mkdir(dirname(filePath), { recursive: true });
      doc = { source: undefined, terms: [] };
    }

    // Pick column keys: source column comes from the doc itself when set,
    // otherwise we pick a sensible normalization.
    const sourceCol = doc.source ?? this.pickGlossaryColumnKey(doc, sourceLanguage);
    if (!doc.source) doc.source = sourceCol;
    const targetCol = this.pickGlossaryColumnKey(doc, targetLanguage);

    // Find existing row for this source value.
    const existing = doc.terms.find(
      (t) =>
        typeof t[sourceCol] === "string" &&
        t[sourceCol].trim() === sourceTrimmed
    );

    let added = false;
    let updated = false;

    if (existing) {
      const current = typeof existing[targetCol] === "string" ? existing[targetCol].trim() : "";
      if (current === targetTrimmed) {
        return { added: false, updated: false };
      }
      existing[targetCol] = targetTrimmed;
      updated = true;
    } else {
      const newRow: Record<string, string> = {};
      newRow[sourceCol] = sourceTrimmed;
      newRow[targetCol] = targetTrimmed;
      doc.terms.push(newRow);
      added = true;
    }

    await writeFile(filePath, JSON.stringify(doc, null, 2), "utf-8");

    // Invalidate caches so subsequent calls see the new entry.
    this.projectGlossaryCache = undefined;
    this.glossaryCache.clear();

    this.logger.info(
      {
        filePath,
        sourceLang: sourceCol,
        targetLang: targetCol,
        source: sourceTrimmed,
        added,
        updated,
        totalTerms: doc.terms.length,
      },
      "Glossary entry written"
    );
    return { added, updated };
  }

  /**
   * Load a per-language style guide for this project. Reads
   * locales/<projectId>/<lang>/style-guide.md and returns its trimmed
   * contents, or empty string if no file exists. Supports the same
   * candidate-dir fallback as glossary/TM (custom-prefix codes etc.).
   */
  async loadStyleGuide(language: string): Promise<string> {
    const cacheKey = `styleGuide:${language}`;

    if (this.styleGuideCache.has(cacheKey)) {
      this.logger.debug({ language }, "Returning cached language style guide");
      return this.styleGuideCache.get(cacheKey)!;
    }

    for (const dir of this.baseDirs(language)) {
      try {
        const filePath = join(dir, "style-guide.md");
        const content = (await readFile(filePath, "utf-8")).trim();
        if (!content) continue; // empty file → keep looking
        this.styleGuideCache.set(cacheKey, content);
        this.logger.debug(
          { language, dir, length: content.length },
          "Language-specific style guide loaded"
        );
        return content;
      } catch {
        // Try next candidate
      }
    }

    // No file present → cache empty so we don't probe disk every call.
    this.styleGuideCache.set(cacheKey, "");
    return "";
  }

  clearCache(language?: string): void {
    if (language) {
      this.glossaryCache.delete(`glossary:${language}`);
      this.tmCache.delete(`tm:${language}`);
      this.styleGuideCache.delete(`styleGuide:${language}`);
      this.logger.debug({ language }, "Cleared cache for language");
    } else {
      this.glossaryCache.clear();
      this.tmCache.clear();
      this.styleGuideCache.clear();
      this.projectGlossaryCache = undefined;
      this.logger.debug("Cleared all caches");
    }
  }

  /**
   * Append a reviewed source→target pair to the TM file for the given
   * language. Dedupes — if the exact pair is already present, no-op.
   * Uses the same fallback directory lookup as loadTranslationMemory (so
   * a "fr_FR" update writes to "locales/fr/tm.json" if only the base
   * folder exists). If no folder exists yet, creates one at the full
   * locale code.
   */
  async appendTranslationMemoryEntry(
    language: string,
    entry: TranslationMemoryEntry
  ): Promise<{ appended: boolean; filePath: string; total: number }> {
    if (!entry.source || !entry.target) {
      throw new Error("TM entry requires non-empty source and target");
    }

    // Find the existing TM file to update. Prefer the most specific directory.
    let filePath: string | undefined;
    for (const dir of this.baseDirs(language)) {
      const candidate = join(dir, "tm.json");
      if (existsSync(candidate)) {
        filePath = candidate;
        break;
      }
    }
    // No file yet — create it under the project-namespaced path. Legacy
    // (no projectId) installs write to the flat locales/{lang} layout.
    if (!filePath) {
      const base = this.projectId
        ? join(process.cwd(), "locales", this.projectId, language)
        : join(process.cwd(), "locales", language);
      filePath = join(base, "tm.json");
      await mkdir(dirname(filePath), { recursive: true });
    }

    let tm: TranslationMemoryEntry[] = [];
    if (existsSync(filePath)) {
      const content = await readFile(filePath, "utf-8");
      tm = JSON.parse(content) as TranslationMemoryEntry[];
    }

    // Dedupe: exact source+target already present.
    const duplicate = tm.some(
      (e) => e.source === entry.source && e.target === entry.target
    );
    if (duplicate) {
      this.logger.debug(
        { language, filePath, source: entry.source },
        "TM entry already present, skipping"
      );
      return { appended: false, filePath, total: tm.length };
    }

    tm.push(entry);
    await writeFile(filePath, JSON.stringify(tm, null, 2), "utf-8");

    // Invalidate in-memory cache so subsequent loads see the new entry.
    this.tmCache.delete(`tm:${language}`);
    for (const dir of candidateDirs(language)) {
      this.tmCache.delete(`tm:${dir}`);
    }

    this.logger.info(
      { language, filePath, total: tm.length },
      "TM entry appended"
    );
    return { appended: true, filePath, total: tm.length };
  }
}

const _fileLoaders = new Map<string, FileLoader>();

function getFileLoaderInstance(projectId?: string): FileLoader {
  const key = projectId ?? "__default__";
  if (!_fileLoaders.has(key)) {
    _fileLoaders.set(key, new FileLoader(projectId));
  }
  return _fileLoaders.get(key)!;
}

/**
 * Clear in-memory caches on every existing FileLoader instance. Used by
 * the /admin/reload endpoint so on-disk edits to glossary/TM/style-guide
 * files are picked up without restarting the server.
 */
export function clearAllFileLoaderCaches(): void {
  for (const loader of _fileLoaders.values()) {
    loader.clearCache();
  }
}

export { getFileLoaderInstance as fileLoader };
