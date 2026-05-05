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
import { jsonrepair } from "jsonrepair";
import { getLogger } from "./logger.js";
export function tolerantParse(raw) {
    try {
        return { value: JSON.parse(raw), repaired: false };
    }
    catch (strictErr) {
        try {
            const repaired = jsonrepair(raw);
            const value = JSON.parse(repaired);
            try {
                getLogger().debug({
                    originalLength: raw.length,
                    repairedLength: repaired.length,
                    error: strictErr instanceof Error ? strictErr.message : String(strictErr),
                }, "JSON repaired before parse");
            }
            catch {
                /* logger may not be initialized in some test contexts */
            }
            return { value, repaired: true };
        }
        catch {
            // Repair didn't help; surface the original error.
            throw strictErr;
        }
    }
}
//# sourceMappingURL=json-repair.js.map