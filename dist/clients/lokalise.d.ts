import type { LokaliseKey, KeyWithContext, Glossary, ListKeysFilters } from "../types/lokalise.js";
export declare class LokaliseClient {
    private http;
    private projectId;
    private logger;
    private glossaryCache;
    private baseLanguageIso?;
    private listKeysCache?;
    private listKeysInFlight?;
    private keyCache;
    private keyInFlight;
    private static LIST_KEYS_TTL_MS;
    private static KEY_TTL_MS;
    constructor(projectId?: string);
    getKey(keyId: string, language?: string): Promise<LokaliseKey>;
    getKeyWithContext(keyId: string, language: string): Promise<KeyWithContext>;
    getKeyWithAllTranslations(keyId: string): Promise<LokaliseKey>;
    getGlossary(language?: string): Promise<Glossary>;
    listKeys(filters?: ListKeysFilters): Promise<LokaliseKey[]>;
    /**
     * Fetch every key in the project by paginating through all pages.
     * Uses a page size of 500 (Lokalise's max). Not cached — intended for
     * backfill runs where completeness matters more than speed.
     */
    /**
     * Fetch every key in the project by paginating through all pages.
     * Uses a page size of 500 (Lokalise's max). Not cached — intended for
     * backfill runs where completeness matters more than speed.
     */
    listAllKeys(filters?: Omit<ListKeysFilters, "limit" | "offset">): Promise<LokaliseKey[]>;
    updateKeyTranslation(translationId: string, translation: string, _reviewed: boolean): Promise<void>;
    bulkUpdateTranslations(updates: Array<{
        translationId: string;
        translation: string;
        reviewed: boolean;
    }>): Promise<void>;
    clearGlossaryCache(): void;
    getProjectId(): string;
    /**
     * Ensure `tag` is present on the given key. Lokalise tags live on keys,
     * not individual translations. This is a no-op if the tag is already
     * present (so it's safe to call redundantly from each fan-out branch).
     */
    ensureKeyTag(keyId: string | number, tag: string, existingTags: string[]): Promise<void>;
    bulkEnsureKeyTags(keysNeedingTag: Array<{
        keyId: string;
        existingTags: string[];
    }>, tag: string): Promise<void>;
    /**
     * Fetch the project's base language ISO (e.g. "en-US"). Cached in-memory
     * after the first call.
     */
    getBaseLanguageIso(): Promise<string>;
    /**
     * Fetch all language ISO codes configured in the project.
     */
    listProjectLanguages(): Promise<string[]>;
}
declare function getLokaliseClientInstance(projectId?: string): LokaliseClient;
export { getLokaliseClientInstance as lokaliseClient };
//# sourceMappingURL=lokalise.d.ts.map