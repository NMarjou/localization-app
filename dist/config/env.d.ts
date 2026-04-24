import { z } from "zod";
declare const envSchema: z.ZodObject<{
    ANTHROPIC_API_KEY: z.ZodString;
    LOKALISE_API_KEY: z.ZodString;
    LOKALISE_PROJECT_ID: z.ZodOptional<z.ZodString>;
    WEBHOOK_SECRET: z.ZodOptional<z.ZodString>;
    PORT: z.ZodDefault<z.ZodNumber>;
    NODE_ENV: z.ZodDefault<z.ZodEnum<["development", "production", "test"]>>;
}, "strip", z.ZodTypeAny, {
    ANTHROPIC_API_KEY: string;
    LOKALISE_API_KEY: string;
    PORT: number;
    NODE_ENV: "development" | "production" | "test";
    LOKALISE_PROJECT_ID?: string | undefined;
    WEBHOOK_SECRET?: string | undefined;
}, {
    ANTHROPIC_API_KEY: string;
    LOKALISE_API_KEY: string;
    LOKALISE_PROJECT_ID?: string | undefined;
    WEBHOOK_SECRET?: string | undefined;
    PORT?: number | undefined;
    NODE_ENV?: "development" | "production" | "test" | undefined;
}>;
export type Env = z.infer<typeof envSchema>;
export declare function loadEnv(): Env;
export declare function getEnv(): Env;
export {};
//# sourceMappingURL=env.d.ts.map