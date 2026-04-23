declare const env: {
    ANTHROPIC_API_KEY: string;
    LOKALISE_API_KEY: string;
    LOKALISE_PROJECT_ID: string;
    WEBHOOK_SECRET: string;
    PORT: number;
    NODE_ENV: "development" | "production" | "test";
};
declare const logger: import("pino").Logger<never, boolean>;
export { env, logger };
export * from "./config/env.js";
export * from "./utils/logger.js";
export * from "./utils/errors.js";
export * from "./utils/cache.js";
export { LokaliseClient } from "./clients/lokalise.js";
export { HttpClient } from "./clients/http.js";
export { ClaudeClient, claudeClient } from "./clients/claude.js";
export { ClaudeMessagesClient } from "./clients/claude-messages.js";
export { ClaudeBatchClient } from "./clients/claude-batch.js";
export { SystemPromptBuilder } from "./builders/system-prompt.js";
export { UserPromptBuilder } from "./builders/user-prompt.js";
export { PromptManager, promptManager } from "./builders/prompt-manager.js";
export { webhookHandler } from "./handlers/webhook.js";
export type * from "./types/lokalise.js";
export type * from "./types/prompt.js";
export type * from "./types/claude.js";
export type * from "./types/webhook.js";
export * from "./config/style-guide.js";
//# sourceMappingURL=index.d.ts.map