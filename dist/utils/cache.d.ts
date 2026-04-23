/**
 * In-memory cache for prompt cache tracking.
 * Stores cache control hash to detect when TM/glossary changes and cache needs invalidation.
 */
export declare class PromptCacheManager {
    private cacheHashes;
    /**
     * Check if cache is still valid based on TM/glossary hash
     */
    isValid(language: string, hash: string): boolean;
    /**
     * Update cache hash after TM/glossary change
     */
    invalidate(language: string): void;
    /**
     * Record new cache hash
     */
    set(language: string, hash: string): void;
    /**
     * Get current cache hash for language
     */
    get(language: string): string | undefined;
}
export declare const cacheManager: PromptCacheManager;
//# sourceMappingURL=cache.d.ts.map