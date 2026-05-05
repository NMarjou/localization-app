import pino from "pino";
/**
 * Pino is wired with `multistream` so every log line goes to TWO sinks:
 *   1. Either pino-pretty (dev, colored stdout) or raw JSON to stdout (prod).
 *   2. The in-memory ring buffer in log-buffer.ts (powers the /admin/logs SSE).
 *
 * Both sinks receive raw JSON; pino-pretty internally transforms before
 * writing to stdout. The ring stream parses JSON and keeps a bounded
 * recent-history buffer for the UI.
 */
export declare function initLogger(): pino.Logger;
export declare function getLogger(): pino.Logger;
export declare function createChild(context: Record<string, unknown>): pino.Logger;
//# sourceMappingURL=logger.d.ts.map