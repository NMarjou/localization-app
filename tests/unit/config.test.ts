import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("Environment Configuration", () => {
  it("has example env file with all required variables", () => {
    const envExamplePath = join(process.cwd(), ".env.example");
    const envExampleContent = readFileSync(envExamplePath, "utf-8");

    const requiredEnvVars = [
      "ANTHROPIC_API_KEY",
      "LOKALISE_API_KEY",
      "LOKALISE_PROJECT_ID",
      "WEBHOOK_SECRET",
      "PORT",
      "NODE_ENV",
    ];

    requiredEnvVars.forEach((envVar) => {
      expect(envExampleContent).toContain(envVar);
    });
  });

  it("exports Env type and functions from config module", async () => {
    const configModule = await import("../../src/config/env.js");
    expect(configModule.loadEnv).toBeDefined();
    expect(configModule.getEnv).toBeDefined();
    expect(typeof configModule.loadEnv).toBe("function");
    expect(typeof configModule.getEnv).toBe("function");
  });

  it(".env file exists with test values", () => {
    const envPath = join(process.cwd(), ".env");
    const envContent = readFileSync(envPath, "utf-8");
    expect(envContent).toContain("ANTHROPIC_API_KEY");
    expect(envContent).toContain("LOKALISE_API_KEY");
  });
});
