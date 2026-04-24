import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { z } from "zod";
const ProjectSchema = z.object({
    id: z.string().min(1, "Project id is required"),
    name: z.string().min(1, "Project name is required"),
    webhookSecret: z.string().min(1, "Webhook secret is required"),
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
        _projects = [{ id: projectId, name: "Default", webhookSecret }];
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
//# sourceMappingURL=projects.js.map