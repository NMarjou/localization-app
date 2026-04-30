export type StringType = "button" | "tooltip" | "error" | "label" | "title" | "body" | "other";

export interface StringToTranslate {
  key_id: string;
  key_name: string;
  value: string;
  string_type?: StringType;
  max_char_limit?: number;
  screen_or_section?: string;
}

export interface TranslationContext {
  before?: StringToTranslate[];
  after?: StringToTranslate[];
}

export interface TranslationRequest {
  target_language: string;
  target_locale?: string;
  strings: StringToTranslate[];
  context?: TranslationContext;
}

export interface SystemPromptConfig {
  /**
   * Project-level brand voice / general writing rules. Comes from the
   * project's `styleGuide` field in projects.json (or the global default).
   */
  styleGuide: string;
  /**
   * Optional per-project description (what the app is, who uses it, key
   * concepts). Rendered as its own "Application Context" section.
   */
  appContext?: string;
  /**
   * Optional language-specific style guide for this project. Loaded from
   * locales/<projectId>/<lang>/style-guide.md. Stacks ON TOP of the
   * project-level styleGuide and the built-in localeRules.
   */
  projectLanguageStyleGuide?: string;
  glossary: Record<string, string>;
  translationMemory: Array<{
    source: string;
    target: string;
  }>;
  /**
   * How many TM entries to include in the system prompt.
   * Larger values:
   *   - give Claude more reference translations → better consistency
   *   - push the prompt past the model's cache threshold (1024 tokens for
   *     Sonnet, 2048 for Haiku) which unlocks 90%-off cache reads on repeat
   *     calls within the 5-min window.
   * Default: 100.
   */
  tmContextSize?: number;
  /**
   * How many glossary terms to include in the system prompt. Glossaries
   * grow without bound otherwise (a 1000+ term glossary triples per-call
   * cost). Default: 100. Set higher for terminology-heavy projects.
   */
  glossaryContextSize?: number;
  localeRules?: string;
}

export interface PromptResponse {
  translations: Record<string, string>;
  flags?: Array<{
    key_id: string;
    reason: string;
  }>;
}

export interface CacheControlledMessage {
  type: "text";
  text: string;
  cache_control?: {
    type: "ephemeral";
  };
}

export interface PromptMessages {
  system: CacheControlledMessage[];
  messages: Array<{
    role: "user";
    content: string;
  }>;
}
