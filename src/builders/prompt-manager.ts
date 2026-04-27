import { getLogger } from "../utils/logger.js";
import { fileLoader } from "../utils/file-loader.js";
import { getStyleGuide } from "../config/style-guide.js";
import { getProject } from "../config/projects.js";
import { SystemPromptBuilder } from "./system-prompt.js";
import { UserPromptBuilder } from "./user-prompt.js";
import { ValidationError } from "../utils/errors.js";
import type {
  TranslationRequest,
  SystemPromptConfig,
  PromptMessages,
} from "../types/prompt.js";
import type { ModelOption } from "../types/claude.js";

export class PromptManager {
  private logger = getLogger();
  private systemPromptBuilder = new SystemPromptBuilder();
  private userPromptBuilder = new UserPromptBuilder();
  private projectId?: string;

  constructor(projectId?: string) {
    this.projectId = projectId;
  }

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
    const project = this.projectId ? getProject(this.projectId) : undefined;
    const styleGuide = getStyleGuide(language, project?.styleGuide);
    const loader = fileLoader(this.projectId);
    const glossary = await loader.loadGlossary(language);
    const translationMemory = await loader.loadTranslationMemory(language);

    return {
      styleGuide,
      glossary,
      translationMemory,
    };
  }

  /**
   * Returns the Claude model configured for this project.
   * Falls back to haiku-4-5 if no override is set.
   */
  getModel(): ModelOption {
    const project = this.projectId ? getProject(this.projectId) : undefined;
    return (project?.model as ModelOption | undefined) ?? "haiku-4-5";
  }

  clearCache(language?: string): void {
    fileLoader(this.projectId).clearCache(language);
    this.logger.debug({ language }, "Cleared file loader cache");
  }
}

const _promptManagers = new Map<string, PromptManager>();

function getPromptManagerInstance(projectId?: string): PromptManager {
  const key = projectId ?? "__default__";
  if (!_promptManagers.has(key)) {
    _promptManagers.set(key, new PromptManager(projectId));
  }
  return _promptManagers.get(key)!;
}

export { getPromptManagerInstance as promptManager };
