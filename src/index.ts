import { loadEnv } from "./config/env.js";
import { initLogger } from "./utils/logger.js";

// Initialize configuration and logging FIRST before any other imports
const env = loadEnv();
const logger = initLogger();

logger.info(
  { port: env.PORT, env: env.NODE_ENV },
  "Starting translation service"
);

// Export types and utilities for future phases
export { env, logger };
export * from "./config/env.js";
export * from "./utils/logger.js";
export * from "./utils/errors.js";
export * from "./utils/cache.js";

// Export clients
export { LokaliseClient } from "./clients/lokalise.js";
export { HttpClient } from "./clients/http.js";
export { ClaudeClient, claudeClient } from "./clients/claude.js";
export { ClaudeMessagesClient } from "./clients/claude-messages.js";
export { ClaudeBatchClient } from "./clients/claude-batch.js";

// Export builders
export { SystemPromptBuilder } from "./builders/system-prompt.js";
export { UserPromptBuilder } from "./builders/user-prompt.js";
export { PromptManager, promptManager } from "./builders/prompt-manager.js";

// Export handlers
export { webhookHandler } from "./handlers/webhook.js";

// Export types
export type * from "./types/lokalise.js";
export type * from "./types/prompt.js";
export type * from "./types/claude.js";
export type * from "./types/webhook.js";

// Export config
export * from "./config/style-guide.js";

// Start server if this is the main module
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("dist/index.js") ||
  process.argv[1]?.endsWith("index.js");

if (isMainModule) {
  import("./server.js").catch((error) => {
    logger.error(error, "Failed to start server");
    process.exit(1);
  });
}
