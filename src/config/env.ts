import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  LOKALISE_API_KEY: z.string().min(1, "LOKALISE_API_KEY is required"),
  // Optional: kept for single-project fallback. Prefer projects.json for multi-project.
  LOKALISE_PROJECT_ID: z.string().optional(),
  WEBHOOK_SECRET: z.string().optional(),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

export type Env = z.infer<typeof envSchema>;

let env: Env | null = null;

export function loadEnv(): Env {
  if (env) return env;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    console.error("Environment validation failed:");
    Object.entries(errors).forEach(([key, messages]) => {
      console.error(`  ${key}: ${messages?.join(", ")}`);
    });
    process.exit(1);
  }

  env = result.data;
  return env;
}

export function getEnv(): Env {
  if (!env) {
    throw new Error(
      "Environment not loaded. Call loadEnv() before accessing config."
    );
  }
  return env;
}
