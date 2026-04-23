import { getLogger } from "../utils/logger.js";
import { fileLoader } from "../utils/file-loader.js";
import { getStyleGuide } from "../config/style-guide.js";
import { SystemPromptBuilder } from "./system-prompt.js";
import { UserPromptBuilder } from "./user-prompt.js";
import { ValidationError } from "../utils/errors.js";
import type {
  TranslationRequest,
  SystemPromptConfig,
  PromptMessages,
} from "../types/prompt.js";

export class PromptManager {
  private logger = getLogger();
  private systemPromptBuilder = new SystemPromptBuilder();
  private userPromptBuilder = new UserPromptBuilder();

  async buildMessages(
    request: TranslationRequest,
    useCache: boolean = true
  ): Promise<PromptMessages> {
    this.logger.debug(
      { language: request.target_language, useCache },
      "Building prompt messages"
    );

    this.validateRequest(request);

    const config = await this.buildConfig(request.target_language);

    const systemPrompt = await this.systemPromptBuilder.buildSystemPrompt(
      request.target_language,
      config
    );

    const userPrompt = this.userPromptBuilder.buildUserPrompt(request);

    const messages: PromptMessages = {
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: useCache ? { type: "ephemeral" } : undefined,
        },
      ],
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    };

    this.logger.debug(
      {
        systemLength: systemPrompt.length,
        userLength: userPrompt.length,
      },
      "Prompt messages built"
    );

    return messages;
  }

  private validateRequest(request: TranslationRequest): void {
    if (!request.target_language) {
      throw new ValidationError("target_language is required");
    }

    if (!request.strings || request.strings.length === 0) {
      throw new ValidationError("at least one string is required");
    }

    for (const str of request.strings) {
      if (!str.key_id) {
        throw new ValidationError("key_id is required for all strings");
      }
      if (!str.value) {
        throw new ValidationError(`value is required for string ${str.key_id}`);
      }
    }

    this.logger.debug({ request }, "Request validation passed");
  }

  private async buildConfig(language: string): Promise<SystemPromptConfig> {
    const styleGuide = getStyleGuide(language);
    const loader = fileLoader();
    const glossary = await loader.loadGlossary(language);
    const translationMemory = await loader.loadTranslationMemory(language);

    return {
      styleGuide,
      glossary,
      translationMemory,
    };
  }

  clearCache(language?: string): void {
    fileLoader().clearCache(language);
    this.logger.debug({ language }, "Cleared file loader cache");
  }
}

let _promptManager: PromptManager | undefined;

function getPromptManagerInstance(): PromptManager {
  if (!_promptManager) {
    _promptManager = new PromptManager();
  }
  return _promptManager;
}

export { getPromptManagerInstance as promptManager };
