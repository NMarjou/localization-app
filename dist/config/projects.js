import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { z } from "zod";
const ProjectSchema = z.object({
    id: z.string().min(1, "Project id is required"),
    name: z.string().min(1, "Project name is required"),
    webhookSecret: z.string().min(1, "Webhook secret is required"),
    // Per-project overrides — all optional, fall back to global defaults.
    /** Claude model to use for this project. Default: "haiku-4-5". */
    model: z.enum(["haiku-4-5", "sonnet-4-6"]).optional(),
    /**
     * Custom style guide text injected into the system prompt.
     * Overrides the global defaultStyleGuide; locale-specific rules still appended.
     */
    styleGuide: z.string().optional(),
    /**
     * Free-form description of the application being translated. Helps Claude
     * pick the right tone, terminology and register. Examples of useful content:
     *   - what the app does (one-liner)
     *   - who the audience is (B2B vs consumer, technical vs general)
     *   - the domain/industry and any specialised jargon
     *   - key concepts the translator should be aware of
     * Injected into the system prompt as an "Application Context" section.
     */
    appContext: z.string().optional(),
    /**
     * How many TM entries to fold into the cached system prompt.
     * Larger values give Claude more reference translations (better
     * consistency) AND push the prompt past the model's cache threshold so
     * subsequent calls within the 5-min window pay 10% of input cost.
     * Default 100. Lower (e.g. 20) trades cache benefit for shorter prompts.
     */
    tmContextSize: z.number().int().positive().optional(),
    /**
     * How many glossary terms to fold into the cached system prompt.
     * Default 100. Cap exists so a single bloated language file (e.g. 1000+
     * imported terms) doesn't blow up per-call cost.
     */
    glossaryContextSize: z.number().int().positive().optional(),
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
    translationTriggers: z
        .array(z.enum(["proofread", "import", "edit"]))
        .optional(),
    /** Debounce window: flush queue this many ms after the LAST enqueue. */
    coalesceIdleMs: z.number().int().positive().optional(),
    /** Hard cap: flush as soon as the queue reaches this size. */
    coalesceMaxKeys: z.number().int().positive().optional(),
    /**
     * Cron expression for the scheduled fallback flush. Runs even with no
     * recent enqueue events to catch anything stuck (e.g. lost across
     * server restart). Set to "" / null to disable scheduled fallback.
     */
    scheduledFallback: z.string().optional(),
    /**
     * If true, every human-approved target-language translation
     * (translation.approved event from Lokalise) is also written into
     * the project-wide glossary.json — provided the source string passes
     * the "term-like" thresholds below. Existing rows have their language
     * column filled in; short approved sources that don't yet exist in
     * the glossary create new rows. Long sentences only go to TM.
     * Default: false.
     */
    glossaryAutoLearn: z.boolean().optional(),
    /**
     * Maximum character length for a source string to be considered a
     * glossary candidate when glossaryAutoLearn is on. Default: 60.
     */
    glossaryAutoLearnMaxChars: z.number().int().positive().optional(),
    /**
     * Maximum word count for a source string to be considered a glossary
     * candidate when glossaryAutoLearn is on. Default: 8.
     */
    glossaryAutoLearnMaxWords: z.number().int().positive().optional(),
    /**
     * Source language ISO code. When set, the service skips the Lokalise
     * base_language_iso API call on every webhook, saving a round-trip.
     */
    sourceLanguage: z.string().optional(),
    /**
     * Restrict translation to these target language ISO codes.
     * When omitted, all non-source project languages are translated.
     */
    languages: z.array(z.string()).optional(),
    /**
     * Set to false to disable a project without removing it from projects.json.
     * Disabled projects are skipped by the webhook handler and backfill.
     */
    enabled: z.boolean().default(true),
});
let _projects = null;
export function loadProjects() {
    if (_projects)
        return _projects;
    const configPath = join(process.cwd(), "projects.json");
    if (existsSync(configPath)) {
        const raw = JSON.parse(readFileSync(configPath, "utf-8"));
        const result = z.array(ProjectSchema).safeParse(raw);
        if (!result.success) {
            console.error("Invalid projects.json:", result.error.flatten().fieldErrors);
            process.exit(1);
        }
        _projects = result.data;
        return _projects;
    }
    // Fallback: build a single project from legacy env vars.
    const projectId = process.env.LOKALISE_PROJECT_ID;
    const webhookSecret = process.env.WEBHOOK_SECRET;
    if (projectId && webhookSecret) {
        _projects = [{ id: projectId, name: "Default", webhookSecret, enabled: true }];
        return _projects;
    }
    console.error("No projects.json found and no LOKALISE_PROJECT_ID/WEBHOOK_SECRET in env. " +
        "Create a projects.json file — see projects.example.json.");
    process.exit(1);
}
export function getProject(projectId) {
    return loadProjects().find((p) => p.id === projectId);
}
export function getAllProjects() {
    return loadProjects();
}
/**
 * Reset the in-memory project cache so the next loadProjects() call
 * re-reads projects.json from disk. Used by the /admin/reload endpoint.
 */
export function resetProjectsCache() {
    _projects = null;
}
//# sourceMappingURL=projects.js.map