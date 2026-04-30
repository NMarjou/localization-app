import { getLogger } from "../utils/logger.js";
import { getLocaleRules } from "../config/style-guide.js";
export class SystemPromptBuilder {
    logger = getLogger();
    async buildSystemPrompt(language, config) {
        this.logger.debug({ language }, "Building system prompt");
        const sections = [];
        sections.push(this.formatSection("Brand Voice & Style Guide", config.styleGuide));
        if (config.appContext && config.appContext.trim()) {
            sections.push(this.formatSection("Application Context", config.appContext.trim()));
        }
        if (config.projectLanguageStyleGuide &&
            config.projectLanguageStyleGuide.trim()) {
            sections.push(this.formatSection(`Project Style Guide for ${language}`, config.projectLanguageStyleGuide.trim()));
        }
        sections.push(this.formatGlossarySection(language, config.glossary, config.glossaryContextSize ?? 100));
        sections.push(this.formatTranslationMemorySection(config.translationMemory, config.tmContextSize ?? 100));
        const localeRules = config.localeRules || getLocaleRules(language);
        if (localeRules) {
            sections.push(this.formatSection("Locale-Specific Rules", localeRules));
        }
        sections.push(this.formatOutputInstructions());
        const fullPrompt = sections.join("\n\n---\n\n");
        this.logger.debug({ language, sections: sections.length, length: fullPrompt.length }, "System prompt built");
        return fullPrompt;
    }
    formatSection(title, content) {
        return `${title}:\n${content}`;
    }
    formatGlossarySection(language, glossary, cap) {
        const entries = Object.entries(glossary);
        if (entries.length === 0) {
            return `Project Glossary (${language}):\n(No glossary terms defined)`;
        }
        const top = entries.slice(0, cap);
        const terms = top
            .map(([source, target]) => `- ${source} → ${target}`)
            .join("\n");
        const note = entries.length > cap
            ? `\n\n(Showing top ${cap} of ${entries.length} glossary terms)`
            : "";
        return `Project Glossary (${language}):\n${terms}${note}`;
    }
    formatTranslationMemorySection(tm, cap) {
        if (tm.length === 0) {
            return "Translation Memory:\n(No approved translations available)";
        }
        const topPairs = tm.slice(0, cap);
        const pairs = topPairs
            .map(({ source, target }) => `- "${source}" → "${target}"`)
            .join("\n");
        const note = tm.length > cap
            ? `\n\n(Showing top ${cap} of ${tm.length} translation memory entries)`
            : "";
        return `Translation Memory:\n${pairs}${note}`;
    }
    formatOutputInstructions() {
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
7. Return translations keyed exactly by the provided key_id
8. Address the user directly, in a formal register, in every language. Use the formal second-person pronoun and verb forms — for example "vous" in French, "Sie" in German, "usted" in Spanish, "Lei" in Italian, "u" in Dutch, "siz" in Turkish, "Anda" in Indonesian, "você" / "o(a) senhor(a)" in Portuguese, formal "敬語" forms in Japanese, "คุณ" + polite suffixes in Thai. Never use the casual second-person form
9. Be as consistent as possible across translations: identical source terms should produce identical target translations every time, both within this batch and against the translation memory above. If a term has multiple plausible translations, pick one and stay with it`;
    }
}
//# sourceMappingURL=system-prompt.js.map