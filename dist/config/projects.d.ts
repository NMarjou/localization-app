import { z } from "zod";
declare const ProjectSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    webhookSecret: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    webhookSecret: string;
}, {
    id: string;
    name: string;
    webhookSecret: string;
}>;
export type ProjectConfig = z.infer<typeof ProjectSchema>;
export declare function loadProjects(): ProjectConfig[];
export declare function getProject(projectId: string): ProjectConfig | undefined;
export declare function getAllProjects(): ProjectConfig[];
export {};
//# sourceMappingURL=projects.d.ts.map