import { getLogger } from "../utils/logger.js";
import type { TranslationRequest, StringToTranslate } from "../types/prompt.js";

export class UserPromptBuilder {
  private logger = getLogger();

  buildUserPrompt(request: TranslationRequest): string {
    this.logger.debug(
      { language: request.target_language, strings: request.strings.length },
      "Building user prompt"
    );

    const sections: string[] = [];

    sections.push(this.formatLanguageInfo(request));

    if (request.context?.before && request.context.before.length > 0) {
      sections.push(this.formatContextSection("Context (Before)", request.context.before));
    }

    sections.push(this.formatStringsSection(request.strings));

    if (request.context?.after && request.context.after.length > 0) {
      sections.push(this.formatContextSection("Context (After)", request.context.after));
    }

    const fullPrompt = sections.join("\n\n");

    this.logger.debug(
      { length: fullPrompt.length },
      "User prompt built"
    );

    return fullPrompt;
  }

  private formatLanguageInfo(request: TranslationRequest): string {
    const locale = request.target_locale
      ? ` (${request.target_locale})`
      : "";
    return `Target Language: ${request.target_language}${locale}`;
  }

  private formatContextSection(
    title: string,
    strings: StringToTranslate[]
  ): string {
    const items = strings
      .map((str) => `- [${str.key_id}] ${str.key_name}: "${str.value}"`)
      .join("\n");

    return `${title}:\n${items}`;
  }

  private formatStringsSection(strings: StringToTranslate[]): string {
    const items = strings
      .map((str, index) => this.formatStringItem(str, index + 1))
      .join("\n\n");

    return `Strings to Translate:\n${items}`;
  }

  private formatStringItem(str: StringToTranslate, index: number): string {
    const parts: string[] = [
      `${index}. [${str.key_id}] ${str.key_name}`,
    ];

    const metadata: string[] = [];

    if (str.string_type) {
      metadata.push(`type: ${str.string_type}`);
    }

    if (str.max_char_limit) {
      metadata.push(`max: ${str.max_char_limit} chars`);
    }

    if (str.screen_or_section) {
      metadata.push(`context: ${str.screen_or_section}`);
    }

    if (metadata.length > 0) {
      parts.push(`(${metadata.join(", ")})`);
    }

    parts.push(`"${str.value}"`);

    return parts.join("\n   ");
  }
}
