import type { TranslationRequest, PromptMessages } from "../types/prompt.js";
import type { ModelOption } from "../types/claude.js";
export declare class PromptManager {
    private logger;
    private systemPromptBuilder;
    private userPromptBuilder;
    private projectId?;
    constructor(projectId?: string);
    buildMessages(request: TranslationRequest, useCache?: boolean): Promise<PromptMessages>;
    private validateRequest;
    private buildConfig;
    /**
     * Returns the Claude model configured for this project.
     * Falls back to haiku-4-5 if no override is set.
     */
    getModel(): ModelOption;
    clearCache(language?: string): void;
}
declare function getPromptManagerInstance(projectId?: string): PromptManager;
export { getPromptManagerInstance as promptManager };
//# sourceMappingURL=prompt-manager.d.ts.map