import { getLogger } from "./logger.js";
/**
 * In-memory cache for prompt cache tracking.
 * Stores cache control hash to detect when TM/glossary changes and cache needs invalidation.
 */
export class PromptCacheManager {
    cacheHashes = new Map();
    /**
     * Check if cache is still valid based on TM/glossary hash
     */
    isValid(language, hash) {
        const cached = this.cacheHashes.get(language);
        return cached === hash;
    }
    /**
     * Update cache hash after TM/glossary change
     */
    invalidate(language) {
        getLogger().debug({ language }, "Invalidating prompt cache");
        this.cacheHashes.delete(language);
    }
    /**
     * Record new cache hash
     */
    set(language, hash) {
        this.cacheHashes.set(language, hash);
    }
    /**
     * Get current cache hash for language
     */
    get(language) {
        return this.cacheHashes.get(language);
    }
}
export const cacheManager = new PromptCacheManager();
//# sourceMappingURL=cache.js.map