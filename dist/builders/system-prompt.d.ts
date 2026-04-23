import type { SystemPromptConfig } from "../types/prompt.js";
export declare class SystemPromptBuilder {
    private logger;
    buildSystemPrompt(language: string, config: SystemPromptConfig): Promise<string>;
    private formatSection;
    private formatGlossarySection;
    private formatTranslationMemorySection;
    private formatOutputInstructions;
}
//# sourceMappingURL=system-prompt.d.ts.map