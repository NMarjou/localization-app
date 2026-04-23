export interface TranslationMemoryEntry {
    source: string;
    target: string;
}
export declare class FileLoader {
    private logger;
    private glossaryCache;
    private tmCache;
    loadGlossary(language: string): Promise<Record<string, string>>;
    loadTranslationMemory(language: string): Promise<TranslationMemoryEntry[]>;
    clearCache(language?: string): void;
}
declare function getFileLoaderInstance(): FileLoader;
export { getFileLoaderInstance as fileLoader };
//# sourceMappingURL=file-loader.d.ts.map