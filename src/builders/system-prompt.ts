import { getLogger } from "../utils/logger.js";
import { fileLoader } from "../utils/file-loader.js";
import { getStyleGuide, getLocaleRules } from "../config/style-guide.js";
import type { SystemPromptConfig } from "../types/prompt.js";

export class SystemPromptBuilder {
  private logger = getLogger();

  async buildSystemPrompt(
    language: string,
    config: SystemPromptConfig
  ): Promise<string> {
    this.logger.debug({ language }, "Building system prompt");

    const sections: string[] = [];

    sections.push(this.formatSection("Brand Voice & Style Guide", config.styleGuide));

    sections.push(this.formatGlossarySection(language, config.glossary));

    sections.push(this.formatTranslationMemorySection(config.translationMemory));

    const localeRules = config.localeRules || getLocaleRules(language);
    if (localeRules) {
      sections.push(this.formatSection("Locale-Specific Rules", localeRules));
    }

    sections.push(this.formatOutputInstructions());

    const fullPrompt = sections.join("\n\n---\n\n");

    this.logger.debug(
      { language, sections: sections.length, length: fullPrompt.length },
      "System prompt built"
    );

    return fullPrompt;
  }

  private formatSection(title: string, content: string): string {
    return `${title}:\n${content}`;
  }

  private formatGlossarySection(
    language: string,
    glossary: Record<string, string>
  ): string {
    if (Object.keys(glossary).length === 0) {
      return `Project Glossary (${language}):\n(No glossary terms defined)`;
    }

    const terms = Object.entries(glossary)
      .map(([source, target]) => `- ${source} → ${target}`)
      .join("\n");

    return `Project Glossary (${language}):\n${terms}`;
  }

  private formatTranslationMemorySection(
    tm: Array<{ source: string; target: string }>
  ): string {
    if (tm.length === 0) {
      return "Translation Memory:\n(No approved translations available)";
    }

    const topPairs = tm.slice(0, 20);
    const pairs = topPairs
      .map(({ source, target }) => `- "${source}" → "${target}"`)
      .join("\n");

    const note =
      tm.length > 20
        ? `\n\n(Showing top 20 of ${tm.length} translation memory entries)`
        : "";

    return `Translation Memory:\n${pairs}${note}`;
  }

  private formatOutputInstructions(): string {
    return `Output Format:
You are a professional translator. Translate the provided strings from the source language to the target language.

Return ONLY a valid JSON response with no preamble, explanation, or markdown formatting.
The response must be valid JSON that can be parsed immediately.

Response Structure:
{
  "translations": {
    "key_id_1": "translated text here",
    "key_id_2": "another translation"
  },
  "flags": [
    {
      "key_id": "key_id_3",
      "reason": "Description of why this string needs review (e.g., 'Glossary term not found: Dashboard')"
    }
  ]
}

Rules:
1. Use the glossary terms provided; flag if a term appears without a translation
2. Reference translation memory for consistency with approved translations
3. Respect character limits specified for each string
4. Consider the string type (button, tooltip, error, etc.) for appropriate tone
5. Maintain the original formatting and punctuation
6. Flag any strings with cultural references or ambiguity that require human review
7. Return translations keyed exactly by the provided key_id`;
  }
}
