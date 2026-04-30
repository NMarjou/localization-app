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
- Always use the formal "vous" form (never "tu") with formal verb conjugations
- Ensure gender agreement with nouns and adjectives
- Avoid anglicisms; prefer French equivalents
- Use proper French spacing (non-breaking space before ! ? : ; «»)
- Numbers: use space as thousand separator (e.g., 1 000 instead of 1,000)`,
    de: `German-Specific Rules:
- Always use the formal "Sie" form (never "du") with capital "S"
- Capitalize all nouns
- Ensure gender agreement (der/die/das) and case agreement
- Avoid unnecessary anglicisms
- Use German formatting for numbers and dates (1.000,00 / DD.MM.YYYY)`,
    es: `Spanish-Specific Rules:
- Always use the formal "usted" form with third-person verb conjugations (never "tú")
- Ensure gender agreement with nouns and adjectives
- Use inverted punctuation (¿ ¡) at start of sentences
- Prefer neutral Spanish; avoid regional variations
- Numbers: comma as decimal, period as thousand separator (e.g., 1.000,00)`,
    it: `Italian-Specific Rules:
- Always use the formal "Lei" form ("dare del Lei") with third-person feminine verbs (never "tu")
- Capitalize Lei, La, Le, Suo when used as the formal pronoun
- Ensure gender and number agreement
- Numbers: comma as decimal, period as thousand separator`,
    pt: `Portuguese-Specific Rules:
- Always use formal address: "você" (or "o senhor / a senhora" when more deferential is appropriate)
- Never use the informal "tu" form
- Prefer European Portuguese spelling and orthography (Acordo Ortográfico)
- Ensure gender and number agreement`,
    nl: `Dutch-Specific Rules:
- Always use the formal "u" form (never "je" or "jij")
- Capitalize "U" when used as a sign of respect in formal correspondence
- Use Dutch number formatting (1.000,00)`,
    ja: `Japanese-Specific Rules:
- Use formal register (敬語 / です・ます調) for all UI text
- Default to polite verb endings (～ます, ～です)
- Avoid gendered language and casual sentence-final particles
- Keep line length reasonable for readability
- Use full-width punctuation`,
    tr: `Turkish-Specific Rules:
- Always use the formal plural "siz" form with second-person plural verb endings (never the singular "sen")
- Apply vowel harmony correctly
- Use Turkish-specific characters (ğ, ı, İ, ö, ş, ü, ç) — never substitute ASCII equivalents`,
    id: `Indonesian-Specific Rules:
- Always address the user as "Anda" (capitalized, formal). Never use "kamu" or "lo"
- Prefer standard Bahasa Indonesia spelling (PUEBI)
- Avoid Jakartan slang or informal abbreviations`,
    th: `Thai-Specific Rules:
- Address the user with the polite pronoun "คุณ" plus polite sentence-ending particles (ครับ for general / formal contexts)
- Avoid casual or pronoun-dropping forms
- Maintain proper Thai word spacing (Thai uses spaces only between sentences/clauses, not between words)`,
};
/**
 * Normalise a language code down to its base ISO 639-1 form for locale-rule
 * lookup. Handles both region separators and Lokalise's custom-prefix
 * codes (e.g. "translations.nl-NL" → "nl").
 */
function languageBase(language) {
    const afterLastDot = language.includes(".")
        ? language.slice(language.lastIndexOf(".") + 1)
        : language;
    return afterLastDot.split(/[-_]/)[0];
}
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
    const localeRules = localeSpecificRules[languageBase(language)];
    return localeRules ? `${base}\n\n${localeRules}` : base;
}
export function getLocaleRules(language) {
    return localeSpecificRules[languageBase(language)];
}
//# sourceMappingURL=style-guide.js.map