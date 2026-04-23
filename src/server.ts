import express, { Request, Response } from "express";
import { getEnv } from "./config/env.js";
import { getLogger } from "./utils/logger.js";
import { WebhookError } from "./utils/errors.js";
import { webhookHandler } from "./handlers/webhook.js";
import type {
  LokaliseWebhookEvent,
  WebhookContext,
} from "./types/webhook.js";

const env = getEnv();
const logger = getLogger();
const app = express();

// Middleware
app.use(express.json());

// Lokalise webhook paths (Lokalise UI uses /webhooks by default; we accept both).
const WEBHOOK_PATHS = new Set(["/webhook", "/webhooks"]);

// Secret-header validation middleware.
// Lokalise sends the configured secret verbatim in one of:
//   X-Secret | X-Api-Key | a custom header (configured in Lokalise UI)
// If the user picks "Custom", set WEBHOOK_HEADER_NAME in .env to match.
app.use((req: Request, res: Response, next) => {
  // Only enforce on POST; GET is a health probe from Lokalise's URL validator.
  if (req.method !== "POST" || !WEBHOOK_PATHS.has(req.path)) {
    return next();
  }

  const customHeader = process.env.WEBHOOK_HEADER_NAME?.toLowerCase();
  const received =
    (customHeader && (req.headers[customHeader] as string)) ||
    (req.headers["x-secret"] as string) ||
    (req.headers["x-api-key"] as string);

  if (!received) {
    logger.warn({ path: req.path }, "Missing webhook secret header");
    return res.status(401).json({ error: "Missing secret header" });
  }

  const isValid = webhookHandler.validateSecret(received, env.WEBHOOK_SECRET);
  if (!isValid) {
    logger.warn({ path: req.path }, "Invalid webhook secret");
    return res.status(401).json({ error: "Invalid secret" });
  }

  next();
});

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    pendingBatches: webhookHandler.getPendingBatchCount(),
    timestamp: new Date().toISOString(),
  });
});

// Respond 200 to any HEAD/GET probe on the webhook path so Lokalise URL
// validation passes regardless of which verb it probes with.
app.get(["/webhook", "/webhooks"], (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

// Webhook endpoint (accepts both /webhook and /webhooks).
app.post(["/webhook", "/webhooks"], async (req: Request, res: Response) => {
  const eventId = req.headers["x-lokalise-event-id"] as string;

  try {
    const event: LokaliseWebhookEvent = req.body;

    if (!event.event || !event.project_id) {
      logger.warn({ eventId }, "Malformed webhook event");
      return res.status(400).json({ error: "Missing required fields" });
    }

    const context: WebhookContext = {
      eventId: eventId || `webhook_${Date.now()}`,
      sourceLanguage: "",
      targetLanguage: "",
      keyIds: [],
      timestamp: Date.now(),
    };

    // Return 202 Accepted immediately (async processing)
    res.status(202).json({ eventId: context.eventId });

    // Process event asynchronously
    await webhookHandler.handleEvent(event, context);
  } catch (error) {
    logger.error(
      {
        eventId,
        error: error instanceof Error ? error.message : String(error),
      },
      "Webhook processing error"
    );
    // Already sent 202, but log the error for monitoring
  }
});

// Batch polling interval (every 30 seconds)
const pollInterval = setInterval(() => {
  webhookHandler
    .pollPendingBatches()
    .catch((error) =>
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "Batch polling failed"
      )
    );
}, 30 * 1000);

// Graceful shutdown
const shutdown = () => {
  logger.info("Shutting down server");
  clearInterval(pollInterval);
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Start server
const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV },
    "Translation service started"
  );
});

export { app, server };
