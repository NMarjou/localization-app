export declare const defaultStyleGuide = "Brand Voice & Style Guide:\n\nTone:\n- Professional yet approachable\n- Clear and concise without being robotic\n- Confident but humble\n\nRegister:\n- Formal for enterprise/B2B contexts\n- Slightly casual for consumer/B2C contexts\n- No contractions in formal settings\n\nBest Practices:\n- Use active voice whenever possible\n- Avoid gendered pronouns; use \"they\" or rephrase\n- Keep sentences short (under 15 words when possible)\n- Avoid technical jargon unless necessary\n- Be consistent with existing terminology\n\nWhat to Avoid:\n- Slang and colloquialisms\n- Cultural references specific to one region\n- Unnecessary complex words\n- All caps (except for acronyms)\n- Exclamation marks (unless emphasizing urgency)\n\nOutput Requirements:\n- Always return valid JSON\n- Keep translations within character limits\n- Maintain formatting and structure of original\n- Flag any ambiguities or cultural issues";
export declare const localeSpecificRules: Record<string, string>;
/**
 * Build the full style guide for a given language and optional project override.
 *
 * Composition order:
 *   1. Project-level styleGuide (if set), otherwise defaultStyleGuide
 *   2. Locale-specific rules appended after (always, if available)
 */
export declare function getStyleGuide(language?: string, projectStyleGuide?: string): string;
export declare function getLocaleRules(language: string): string | undefined;
//# sourceMappingURL=style-guide.d.ts.map