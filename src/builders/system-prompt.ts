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

    if (config.appContext && config.appContext.trim()) {
      sections.push(this.formatSection("Application Context", config.appContext.trim()));
    }

    if (
      config.projectLanguageStyleGuide &&
      config.projectLanguageStyleGuide.trim()
    ) {
      sections.push(
        this.formatSection(
          `Project Style Guide for ${language}`,
          config.projectLanguageStyleGuide.trim()
        )
      );
    }

    sections.push(
      this.formatGlossarySection(
        language,
        config.glossary,
        config.glossaryContextSize ?? 100
      )
    );

    sections.push(
      this.formatTranslationMemorySection(
        config.translationMemory,
        config.tmContextSize ?? 100
      )
    );

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
    glossary: Record<string, string>,
    cap: number
  ): string {
    const entries = Object.entries(glossary);
    if (entries.length === 0) {
      return `Project Glossary (${language}):\n(No glossary terms defined)`;
    }

    const top = entries.slice(0, cap);
    const terms = top
      .map(([source, target]) => `- ${source} → ${target}`)
      .join("\n");

    const note =
      entries.length > cap
        ? `\n\n(Showing top ${cap} of ${entries.length} glossary terms)`
        : "";

    return `Project Glossary (${language}):\n${terms}${note}`;
  }

  private formatTranslationMemorySection(
    tm: Array<{ source: string; target: string }>,
    cap: number
  ): string {
    if (tm.length === 0) {
      return "Translation Memory:\n(No approved translations available)";
    }

    const topPairs = tm.slice(0, cap);
    const pairs = topPairs
      .map(({ source, target }) => `- "${source}" → "${target}"`)
      .join("\n");

    const note =
      tm.length > cap
        ? `\n\n(Showing top ${cap} of ${tm.length} translation memory entries)`
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
1. **Always produce a translation for every key_id you receive.** The translations object MUST contain one entry per requested key_id. Never skip a key. If you are uncertain or the source is ambiguous, still provide your best translation and add an entry to flags explaining the concern — never substitute a flag for a missing translation.
2. Use the glossary terms provided; flag if a term appears without a translation, but still translate the surrounding string.
3. Reference translation memory for consistency with approved translations.
4. Respect character limits specified for each string.
5. Consider the string type (button, tooltip, error, etc.) for appropriate tone.
6. Maintain the original formatting and punctuation, including ICU placeholders, HTML tags, and variables (e.g. {name}, {{count}}, %s, <strong>). **Quotation marks must match the source exactly.** If the source uses ASCII straight double quotes ("..."), keep ASCII straight quotes in the translation. Do NOT substitute typographic / curly / language-specific quotes (e.g. curly "...", Croatian „...", French «…», German „…", Japanese 「…」) — even if those are the conventional style for the target language. The application applies typographic styling at render time; mixing typographic and ASCII quotes inside a translation breaks downstream serialization.
7. Flags are additive metadata only. They never replace a translation. Use them to signal: cultural references, glossary mismatches, missing context, ambiguous source, or potential character-limit overflow.
8. Return translations keyed exactly by the provided key_id (as a string).
9. Address the user directly, in a formal register, in every language. Use the formal second-person pronoun and verb forms — for example "vous" in French, "Sie" in German, "usted" in Spanish, "Lei" in Italian, "u" in Dutch, "siz" in Turkish, "Anda" in Indonesian, "você" / "o(a) senhor(a)" in Portuguese, formal "敬語" forms in Japanese, "คุณ" + polite suffixes in Thai. Never use the casual second-person form.
10. Be as consistent as possible across translations: identical source terms should produce identical target translations every time, both within this batch and against the translation memory above. If a term has multiple plausible translations, pick one and stay with it.`;
  }
}
