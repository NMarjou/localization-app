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
    sourceLanguage?: string | undefined;
    languages?: string[] | undefined;
}, {
    id: string;
    name: string;
    webhookSecret: string;
    model?: "haiku-4-5" | "sonnet-4-6" | undefined;
    enabled?: boolean | undefined;
    styleGuide?: string | undefined;
    sourceLanguage?: string | undefined;
    languages?: string[] | undefined;
}>;
export type ProjectConfig = z.infer<typeof ProjectSchema>;
export declare function loadProjects(): ProjectConfig[];
export declare function getProject(projectId: string): ProjectConfig | undefined;
export declare function getAllProjects(): ProjectConfig[];
export {};
//# sourceMappingURL=projects.d.ts.map