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

// HMAC validation middleware
app.use((req: Request, res: Response, next) => {
  if (req.path !== "/webhook") {
    return next();
  }

  const signature = req.headers["x-lokalise-signature"] as string;
  if (!signature) {
    logger.warn({ path: req.path }, "Missing webhook signature");
    return res.status(401).json({ error: "Missing signature" });
  }

  const payload = JSON.stringify(req.body);
  const isValid = webhookHandler.validateSignature(
    payload,
    signature,
    env.WEBHOOK_SECRET
  );

  if (!isValid) {
    logger.warn(
      { path: req.path, signature: signature.slice(0, 10) + "..." },
      "Invalid webhook signature"
    );
    return res.status(401).json({ error: "Invalid signature" });
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

// Webhook endpoint
app.post("/webhook", async (req: Request, res: Response) => {
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
