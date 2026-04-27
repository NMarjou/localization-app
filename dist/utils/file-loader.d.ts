export interface TranslationMemoryEntry {
    source: string;
    target: string;
}
export declare class FileLoader {
    private logger;
    private glossaryCache;
    private tmCache;
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
    loadGlossary(language: string): Promise<Record<string, string>>;
    loadTranslationMemory(language: string): Promise<TranslationMemoryEntry[]>;
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