import pino from "pino";
import pretty from "pino-pretty";
import { getEnv } from "../config/env.js";
import { logRingStream } from "./log-buffer.js";
let logger = null;
/**
 * Pino is wired with `multistream` so every log line goes to TWO sinks:
 *   1. Either pino-pretty (dev, colored stdout) or raw JSON to stdout (prod).
 *   2. The in-memory ring buffer in log-buffer.ts (powers the /admin/logs SSE).
 *
 * Both sinks receive raw JSON; pino-pretty internally transforms before
 * writing to stdout. The ring stream parses JSON and keeps a bounded
 * recent-history buffer for the UI.
 */
export function initLogger() {
    if (logger)
        return logger;
    const env = getEnv();
    const isProduction = env.NODE_ENV === "production";
    // Stream 1: human-readable destination (pretty in dev, raw JSON in prod).
    const humanStream = isProduction
        ? process.stdout
        : pretty({
            colorize: true,
            singleLine: false,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
            destination: process.stdout,
        });
    const streams = [
        { stream: humanStream },
        { stream: logRingStream },
    ];
    logger = pino({
        level: isProduction ? "info" : "debug",
        timestamp: pino.stdTimeFunctions.isoTime,
        base: {
            env: env.NODE_ENV,
        },
    }, pino.multistream(streams));
    return logger;
}
export function getLogger() {
    if (!logger) {
        throw new Error("Logger not initialized. Call initLogger() before accessing it.");
    }
    return logger;
}
export function createChild(context) {
    return getLogger().child(context);
}
//# sourceMappingURL=logger.js.map