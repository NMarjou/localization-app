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
 * base language ("fr"). Handles both "fr_FR" and "fr-FR" separators.
 */
function candidateDirs(language: string): string[] {
  const candidates = new Set<string>();
  candidates.add(language);
  const base = language.split(/[-_]/)[0];
  if (base && base !== language) candidates.add(base);
  return [...candidates];
}

export class FileLoader {
  private logger = getLogger();
  private glossaryCache: Map<string, Record<string, string>> = new Map();
  private tmCache: Map<string, TranslationMemoryEntry[]> = new Map();

  async loadGlossary(language: string): Promise<Record<string, string>> {
    const cacheKey = `glossary:${language}`;

    if (this.glossaryCache.has(cacheKey)) {
      this.logger.debug({ language }, "Returning cached glossary");
      return this.glossaryCache.get(cacheKey)!;
    }

    for (const dir of candidateDirs(language)) {
      try {
        const filePath = join(process.cwd(), "locales", dir, "glossary.json");
        this.logger.debug({ filePath }, "Loading glossary from file");

        const content = await readFile(filePath, "utf-8");
        const glossary = JSON.parse(content) as Record<string, string>;

        this.glossaryCache.set(cacheKey, glossary);
        this.logger.debug(
          { language, dir, terms: Object.keys(glossary).length },
          "Glossary loaded"
        );

        return glossary;
      } catch {
        // Try next candidate
      }
    }

    this.logger.warn(
      { language, tried: candidateDirs(language) },
      "Failed to load glossary, returning empty"
    );
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

    for (const dir of candidateDirs(language)) {
      try {
        const filePath = join(process.cwd(), "locales", dir, "tm.json");
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

    this.logger.warn(
      { language, tried: candidateDirs(language) },
      "Failed to load translation memory, returning empty"
    );
    return [];
  }

  clearCache(language?: string): void {
    if (language) {
      this.glossaryCache.delete(`glossary:${language}`);
      this.tmCache.delete(`tm:${language}`);
      this.logger.debug({ language }, "Cleared cache for language");
    } else {
      this.glossaryCache.clear();
      this.tmCache.clear();
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

    // Find the existing TM file to update. Prefer the most specific
    // directory that already has a tm.json.
    const candidates = candidateDirs(language);
    let filePath: string | undefined;
    for (const dir of candidates) {
      const candidate = join(process.cwd(), "locales", dir, "tm.json");
      if (existsSync(candidate)) {
        filePath = candidate;
        break;
      }
    }
    // No file yet — create it under the full locale code.
    if (!filePath) {
      filePath = join(process.cwd(), "locales", language, "tm.json");
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
    for (const dir of candidates) {
      this.tmCache.delete(`tm:${dir}`);
    }

    this.logger.info(
      { language, filePath, total: tm.length },
      "TM entry appended"
    );
    return { appended: true, filePath, total: tm.length };
  }
}

let _fileLoader: FileLoader | undefined;

function getFileLoaderInstance(): FileLoader {
  if (!_fileLoader) {
    _fileLoader = new FileLoader();
  }
  return _fileLoader;
}

export { getFileLoaderInstance as fileLoader };
