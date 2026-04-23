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
    constructor();
    getKey(keyId: string, language?: string): Promise<LokaliseKey>;
    getKeyWithContext(keyId: string, language: string): Promise<KeyWithContext>;
    getKeyWithAllTranslations(keyId: string): Promise<LokaliseKey>;
    getGlossary(language?: string): Promise<Glossary>;
    listKeys(filters?: ListKeysFilters): Promise<LokaliseKey[]>;
    updateKeyTranslation(translationId: string, translation: string, _reviewed: boolean): Promise<void>;
    clearGlossaryCache(): void;
    getProjectId(): string;
    /**
     * Ensure `tag` is present on the given key. Lokalise tags live on keys,
     * not individual translations. This is a no-op if the tag is already
     * present (so it's safe to call redundantly from each fan-out branch).
     */
    ensureKeyTag(keyId: string | number, tag: string, existingTags: string[]): Promise<void>;
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
declare function getLokaliseClientInstance(): LokaliseClient;
export { getLokaliseClientInstance as lokaliseClient };
//# sourceMappingURL=lokalise.d.ts.map