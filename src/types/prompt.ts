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
  styleGuide: string;
  glossary: Record<string, string>;
  translationMemory: Array<{
    source: string;
    target: string;
  }>;
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
