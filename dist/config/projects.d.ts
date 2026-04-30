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
    id: string;
    enabled: boolean;
    name: string;
    webhookSecret: string;
    model?: "haiku-4-5" | "sonnet-4-6" | undefined;
    styleGuide?: string | undefined;
    appContext?: string | undefined;
    tmContextSize?: number | undefined;
    glossaryContextSize?: number | undefined;
    glossaryAutoLearn?: boolean | undefined;
    glossaryAutoLearnMaxChars?: number | undefined;
    glossaryAutoLearnMaxWords?: number | undefined;
    sourceLanguage?: string | undefined;
    languages?: string[] | undefined;
}, {
    id: string;
    name: string;
    webhookSecret: string;
    model?: "haiku-4-5" | "sonnet-4-6" | undefined;
    enabled?: boolean | undefined;
    styleGuide?: string | undefined;
    appContext?: string | undefined;
    tmContextSize?: number | undefined;
    glossaryContextSize?: number | undefined;
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
export {};
//# sourceMappingURL=projects.d.ts.map