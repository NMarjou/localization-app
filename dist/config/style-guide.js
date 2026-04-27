export const defaultStyleGuide = `Brand Voice & Style Guide:

Tone:
- Professional yet approachable
- Clear and concise without being robotic
- Confident but humble

Register:
- Formal for enterprise/B2B contexts
- Slightly casual for consumer/B2C contexts
- No contractions in formal settings

Best Practices:
- Use active voice whenever possible
- Avoid gendered pronouns; use "they" or rephrase
- Keep sentences short (under 15 words when possible)
- Avoid technical jargon unless necessary
- Be consistent with existing terminology

What to Avoid:
- Slang and colloquialisms
- Cultural references specific to one region
- Unnecessary complex words
- All caps (except for acronyms)
- Exclamation marks (unless emphasizing urgency)

Output Requirements:
- Always return valid JSON
- Keep translations within character limits
- Maintain formatting and structure of original
- Flag any ambiguities or cultural issues`;
export const localeSpecificRules = {
    fr: `French-Specific Rules:
- Use formal "vous" for professional contexts, "tu" for casual/friendly content
- Ensure gender agreement with nouns
- Avoid anglicisms; prefer French equivalents
- Use proper French spacing (space before punctuation like ! ? :)
- Numbers: use space as thousand separator (e.g., 1 000 instead of 1,000)`,
    de: `German-Specific Rules:
- Capitalize all nouns
- Use "Sie" for formal contexts
- Ensure gender agreement (der/die/das)
- Avoid unnecessary anglicisms
- Use German formatting for numbers and dates`,
    es: `Spanish-Specific Rules:
- Use "usted" for formal, "tú" for casual
- Ensure gender agreement with nouns and adjectives
- Use inverted punctuation (¿ ¡) at start of sentences
- Avoid regional variations when possible
- Use Spanish formatting for numbers (comma as decimal, space as thousand separator)`,
    ja: `Japanese-Specific Rules:
- Use polite form (～ます) for UI text
- Use formal register (敬語) for customer-facing content
- Avoid gendered language
- Keep line length reasonable for readability
- Use full-width punctuation`,
};
/**
 * Build the full style guide for a given language and optional project override.
 *
 * Composition order:
 *   1. Project-level styleGuide (if set), otherwise defaultStyleGuide
 *   2. Locale-specific rules appended after (always, if available)
 */
export function getStyleGuide(language, projectStyleGuide) {
    const base = projectStyleGuide ?? defaultStyleGuide;
    if (!language)
        return base;
    // Normalise "fr-FR" or "fr_FR" → "fr" for lookup
    const langBase = language.split(/[-_]/)[0];
    const localeRules = localeSpecificRules[langBase];
    return localeRules ? `${base}\n\n${localeRules}` : base;
}
export function getLocaleRules(language) {
    const langBase = language.split(/[-_]/)[0];
    return localeSpecificRules[langBase];
}
//# sourceMappingURL=style-guide.js.map