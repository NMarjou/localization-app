/**
 * Tolerant JSON parser used for Claude API responses.
 *
 * Why: Claude sometimes emits invalid JSON, especially when the
 * translated text contains quotes, backslashes, or characters the
 * model didn't escape correctly. Non-Latin scripts (Cyrillic, Greek,
 * Thai, Arabic, etc.) trigger this more often.
 *
 * Strategy:
 *   1. Try strict JSON.parse first — the happy path, free.
 *   2. If that fails, run the response through jsonrepair (handles
 *      unescaped quotes, truncated arrays, missing commas/brackets,
 *      smart-quotes, single-quoted strings, trailing commas, etc.).
 *   3. If repaired output also fails to parse, re-throw the ORIGINAL
 *      strict-parse error so retry/fallback logic upstream sees a
 *      meaningful diagnostic.
 */
export interface TolerantParseResult<T = unknown> {
    value: T;
    /** True if jsonrepair was needed to make the string parse. */
    repaired: boolean;
}
export declare function tolerantParse<T = unknown>(raw: string): TolerantParseResult<T>;
//# sourceMappingURL=json-repair.d.ts.map