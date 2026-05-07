import { z } from "zod";
declare const ProjectSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    webhookSecret: z.ZodString;
    /** Claude model to use for this project. Default: "haiku-4-5". */
    model: z.ZodOptional<z.ZodEnum<["haiku-4-5", "sonnet-4-6"]>>;
    /**
     * Custom style guide text injected into the system prompt.
     * Overrides the global defaultStyleGuide; locale-specific rules still appended.
     */
    styleGuide: z.ZodOptional<z.ZodString>;
    /**
     * Free-form description of the application being translated. Helps Claude
     * pick the right tone, terminology and register. Examples of useful content:
     *   - what the app does (one-liner)
     *   - who the audience is (B2B vs consumer, technical vs general)
     *   - the domain/industry and any specialised jargon
     *   - key concepts the translator should be aware of
     * Injected into the system prompt as an "Application Context" section.
     */
    appContext: z.ZodOptional<z.ZodString>;
    /**
     * How many TM entries to fold into the cached system prompt.
     * Larger values give Claude more reference translations (better
     * consistency) AND push the prompt past the model's cache threshold so
     * subsequent calls within the 5-min window pay 10% of input cost.
     * Default 100. Lower (e.g. 20) trades cache benefit for shorter prompts.
     */
    tmContextSize: z.ZodOptional<z.ZodNumber>;
    /**
     * How many glossary terms to fold into the cached system prompt.
     * Default 100. Cap exists so a single bloated language file (e.g. 1000+
     * imported terms) doesn't blow up per-call cost.
     */
    glossaryContextSize: z.ZodOptional<z.ZodNumber>;
    /**
     * Webhook events that enqueue keys for coalesced translation.
     *
     *   undefined  → legacy: each proofread translates immediately (one
     *                Claude call per key per language; expensive).
     *   []         → scheduled-fallback only (webhooks acknowledged but
     *                no enqueue; cron flush picks up missing keys).
     *   ["proofread"]                → enqueue on source proofread.
     *   ["proofread", "import"]      → also enqueue on file imports
     *                                  (e.g. GitHub integration push).
     *   ["proofread", "edit", "import"] → also enqueue on raw source
     *                                  edits without proofread (mirrors
     *                                  Lokalise AI's auto-translate UX).
     *
     * Recommended: `["proofread"]` — keeps the human "ready" gate but
     * batches the consequence into a single backfill run, cutting cost
     * roughly 10× vs the legacy per-key path.
     */
    translationTriggers: z.ZodOptional<z.ZodArray<z.ZodEnum<["proofread", "import", "edit"]>, "many">>;
    /** Debounce window: flush queue this many ms after the LAST enqueue. */
    coalesceIdleMs: z.ZodOptional<z.ZodNumber>;
    /** Hard cap: flush as soon as the queue reaches this size. */
    coalesceMaxKeys: z.ZodOptional<z.ZodNumber>;
    /**
     * Cron expression for the scheduled fallback flush. Runs even with no
     * recent enqueue events to catch anything stuck (e.g. lost across
     * server restart). Set to "" / null to disable scheduled fallback.
     */
    scheduledFallback: z.ZodOptional<z.ZodString>;
    /**
     * If true, every human-approved target-language translation
     * (translation.approved event from Lokalise) is also written into
     * the project-wide glossary.json — provided the source string passes
     * the "term-like" thresholds below. Existing rows have their language
     * column filled in; short approved sources that don't yet exist in
     * the glossary create new rows. Long sentences only go to TM.
     * Default: false.
     */
    glossaryAutoLearn: z.ZodOptional<z.ZodBoolean>;
    /**
     * Maximum character length for a source string to be considered a
     * glossary candidate when glossaryAutoLearn is on. Default: 60.
     */
    glossaryAutoLearnMaxChars: z.ZodOptional<z.ZodNumber>;
    /**
     * Maximum word count for a source string to be considered a glossary
     * candidate when glossaryAutoLearn is on. Default: 8.
     */
    glossaryAutoLearnMaxWords: z.ZodOptional<z.ZodNumber>;
    /**
     * Source language ISO code. When set, the service skips the Lokalise
     * base_language_iso API call on every webhook, saving a round-trip.
     */
    sourceLanguage: z.ZodOptional<z.ZodString>;
    /**
     * Restrict translation to these target language ISO codes.
     * When omitted, all non-source project languages are translated.
     */
    languages: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    /**
     * Set to false to disable a project without removing it from projects.json.
     * Disabled projects are skipped by the webhook handler and backfill.
     */
    enabled: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    name: string;
    id: string;
    enabled: boolean;
    webhookSecret: string;
    model?: "haiku-4-5" | "sonnet-4-6" | undefined;
    styleGuide?: string | undefined;
    appContext?: string | undefined;
    tmContextSize?: number | undefined;
    glossaryContextSize?: number | undefined;
    translationTriggers?: ("proofread" | "import" | "edit")[] | undefined;
    coalesceIdleMs?: number | undefined;
    coalesceMaxKeys?: number | undefined;
    scheduledFallback?: string | undefined;
    glossaryAutoLearn?: boolean | undefined;
    glossaryAutoLearnMaxChars?: number | undefined;
    glossaryAutoLearnMaxWords?: number | undefined;
    sourceLanguage?: string | undefined;
    languages?: string[] | undefined;
}, {
    name: string;
    id: string;
    webhookSecret: string;
    model?: "haiku-4-5" | "sonnet-4-6" | undefined;
    enabled?: boolean | undefined;
    styleGuide?: string | undefined;
    appContext?: string | undefined;
    tmContextSize?: number | undefined;
    glossaryContextSize?: number | undefined;
    translationTriggers?: ("proofread" | "import" | "edit")[] | undefined;
    coalesceIdleMs?: number | undefined;
    coalesceMaxKeys?: number | undefined;
    scheduledFallback?: string | undefined;
    glossaryAutoLearn?: boolean | undefined;
    glossaryAutoLearnMaxChars?: number | undefined;
    glossaryAutoLearnMaxWords?: number | undefined;
    sourceLanguage?: string | undefined;
    languages?: string[] | undefined;
}>;
export type ProjectConfig = z.infer<typeof ProjectSchema>;
export declare function loadProjects(): ProjectConfig[];
export declare function getProject(projectId: string): ProjectConfig | undefined;
export declare function getAllProjects(): ProjectConfig[];
/**
 * Reset the in-memory project cache so the next loadProjects() call
 * re-reads projects.json from disk. Used by the /admin/reload endpoint.
 */
export declare function resetProjectsCache(): void;
export {};
//# sourceMappingURL=projects.d.ts.map