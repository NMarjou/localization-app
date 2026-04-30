export interface TranslationMemoryEntry {
    source: string;
    target: string;
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
export declare class FileLoader {
    private logger;
    private glossaryCache;
    private tmCache;
    private styleGuideCache;
    /** Cache for the project-wide master glossary (loaded once per projectId). */
    private projectGlossaryCache?;
    private projectId?;
    constructor(projectId?: string);
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
    private baseDirs;
    /**
     * Load the project-wide master glossary at
     * locales/<projectId>/glossary.json. Cached after first read; same
     * instance is shared across all languages. Returns null if no file
     * (so legacy per-language glossaries still work).
     */
    private loadProjectGlossary;
    loadGlossary(language: string): Promise<Record<string, string>>;
    loadTranslationMemory(language: string): Promise<TranslationMemoryEntry[]>;
    /**
     * Pick the column key to use when writing into the project-wide glossary
     * for a given Lokalise language code. Prefers a key form that already
     * exists in the file (so new appends stay consistent with imported rows).
     * Falls back to base ISO 639-1.
     */
    private pickGlossaryColumnKey;
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
    appendProjectGlossaryEntry(sourceLanguage: string, targetLanguage: string, source: string, target: string): Promise<{
        added: boolean;
        updated: boolean;
    }>;
    /**
     * Load a per-language style guide for this project. Reads
     * locales/<projectId>/<lang>/style-guide.md and returns its trimmed
     * contents, or empty string if no file exists. Supports the same
     * candidate-dir fallback as glossary/TM (custom-prefix codes etc.).
     */
    loadStyleGuide(language: string): Promise<string>;
    clearCache(language?: string): void;
    /**
     * Append a reviewed source→target pair to the TM file for the given
     * language. Dedupes — if the exact pair is already present, no-op.
     * Uses the same fallback directory lookup as loadTranslationMemory (so
     * a "fr_FR" update writes to "locales/fr/tm.json" if only the base
     * folder exists). If no folder exists yet, creates one at the full
     * locale code.
     */
    appendTranslationMemoryEntry(language: string, entry: TranslationMemoryEntry): Promise<{
        appended: boolean;
        filePath: string;
        total: number;
    }>;
}
declare function getFileLoaderInstance(projectId?: string): FileLoader;
export { getFileLoaderInstance as fileLoader };
//# sourceMappingURL=file-loader.d.ts.map