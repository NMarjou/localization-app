import pino from "pino";
import { getEnv } from "../config/env.js";

let logger: pino.Logger | null = null;

export function initLogger(): pino.Logger {
  if (logger) return logger;

  const env = getEnv();
  const isProduction = env.NODE_ENV === "production";

  logger = pino(
    {
      level: isProduction ? "info" : "debug",
      timestamp: pino.stdTimeFunctions.isoTime,
      base: {
        env: env.NODE_ENV,
      },
    },
    isProduction
      ? pino.transport({ target: "pino/file" })
      : pino.transport({
          target: "pino-pretty",
          options: {
            colorize: true,
            singleLine: false,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        })
  );

  return logger;
}

export function getLogger(): pino.Logger {
  if (!logger) {
    throw new Error(
      "Logger not initialized. Call initLogger() before accessing it."
    );
  }
  return logger;
}

export function createChild(
  context: Record<string, unknown>
): pino.Logger {
  return getLogger().child(context);
}
