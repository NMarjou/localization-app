import { getLogger } from "./logger.js";

/**
 * In-memory cache for prompt cache tracking.
 * Stores cache control hash to detect when TM/glossary changes and cache needs invalidation.
 */
export class PromptCacheManager {
  private cacheHashes: Map<string, string> = new Map();

  /**
   * Check if cache is still valid based on TM/glossary hash
   */
  isValid(language: string, hash: string): boolean {
    const cached = this.cacheHashes.get(language);
    return cached === hash;
  }

  /**
   * Update cache hash after TM/glossary change
   */
  invalidate(language: string): void {
    getLogger().debug({ language }, "Invalidating prompt cache");
    this.cacheHashes.delete(language);
  }

  /**
   * Record new cache hash
   */
  set(language: string, hash: string): void {
    this.cacheHashes.set(language, hash);
  }

  /**
   * Get current cache hash for language
   */
  get(language: string): string | undefined {
    return this.cacheHashes.get(language);
  }
}

export const cacheManager = new PromptCacheManager();
