import type { TranslationRequest, PromptMessages } from "../types/prompt.js";
export declare class PromptManager {
    private logger;
    private systemPromptBuilder;
    private userPromptBuilder;
    private projectId?;
    constructor(projectId?: string);
    buildMessages(request: TranslationRequest, useCache?: boolean): Promise<PromptMessages>;
    private validateRequest;
    private buildConfig;
    clearCache(language?: string): void;
}
declare function getPromptManagerInstance(projectId?: string): PromptManager;
export { getPromptManagerInstance as promptManager };
//# sourceMappingURL=prompt-manager.d.ts.map