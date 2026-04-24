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
     * Tries project-namespaced paths first (locales/{projectId}/{lang}),
     * then falls back to legacy flat structure (locales/{lang}).
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