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

export type ProjectConfig = z.infer<typeof ProjectSchema>;

let _projects: ProjectConfig[] | null = null;

export function loadProjects(): ProjectConfig[] {
  if (_projects) return _projects;

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

  console.error(
    "No projects.json found and no LOKALISE_PROJECT_ID/WEBHOOK_SECRET in env. " +
    "Create a projects.json file — see projects.example.json."
  );
  process.exit(1);
}

export function getProject(projectId: string): ProjectConfig | undefined {
  return loadProjects().find((p) => p.id === projectId);
}

export function getAllProjects(): ProjectConfig[] {
  return loadProjects();
}
