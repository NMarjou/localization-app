import type { LokaliseKey, KeyWithContext, Glossary, ListKeysFilters } from "../types/lokalise.js";
export declare class LokaliseClient {
    private http;
    private projectId;
    private logger;
    private glossaryCache;
    constructor();
    getKey(keyId: string, language?: string): Promise<LokaliseKey>;
    getKeyWithContext(keyId: string, language: string): Promise<KeyWithContext>;
    getKeyWithAllTranslations(keyId: string): Promise<LokaliseKey>;
    getGlossary(language?: string): Promise<Glossary>;
    listKeys(filters?: ListKeysFilters): Promise<LokaliseKey[]>;
    updateKeyTranslation(translationId: string, translation: string, reviewed: boolean): Promise<void>;
    clearGlossaryCache(): void;
    getProjectId(): string;
}
declare function getLokaliseClientInstance(): LokaliseClient;
export { getLokaliseClientInstance as lokaliseClient };
//# sourceMappingURL=lokalise.d.ts.map