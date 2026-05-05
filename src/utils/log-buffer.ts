/**
 * In-memory ring buffer of recent log lines + an EventEmitter for live
 * subscribers. Wired into the pino multistream so every log emitted by
 * the service is captured here in addition to whatever destination the
 * pretty-printer writes to.
 *
 * Backs:
 *   - GET /admin/logs/recent  (snapshot)
 *   - GET /admin/logs/stream  (SSE live tail)
 *
 * Buffer is bounded; old lines are dropped silently.
 */

import { EventEmitter } from "events";
import { Writable } from "stream";

export interface LogLine {
  /** ms epoch at the time we captured the line. */
  ts: number;
  /** pino numeric or label level — kept verbatim for the UI to interpret. */
  level: number | string;
  /** The actual message. */
  msg: string;
  /** Any other structured fields pino emitted. */
  [key: string]: unknown;
}

const RING_SIZE = 1000;
const ring: LogLine[] = [];
const emitter = new EventEmitter();
emitter.setMaxListeners(50);

class RingStream extends Writable {
  _write(
    chunk: Buffer | string,
    _enc: BufferEncoding,
    cb: (err?: Error | null) => void
  ): void {
    try {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      // pino can emit multiple lines per write
      for (const raw of text.split("\n")) {
        const trimmed = raw.trim();
        if (!trimmed) continue;
        try {
          const line = JSON.parse(trimmed) as Record<string, unknown>;
          const entry: LogLine = {
            ts: Date.now(),
            level: (line.level as number | string | undefined) ?? "info",
            msg: typeof line.msg === "string" ? line.msg : "",
            ...line,
          };
          ring.push(entry);
          if (ring.length > RING_SIZE) ring.shift();
          emitter.emit("line", entry);
        } catch {
          // Not JSON (shouldn't happen via pino, but guard anyway).
        }
      }
    } catch {
      // never throw out of a log path
    }
    cb();
  }
}

/** Singleton stream registered with pino.multistream in logger.ts. */
export const logRingStream = new RingStream();

/** Snapshot of the most recent N log lines (newest last). */
export function recentLogs(limit = 250): LogLine[] {
  if (limit >= ring.length) return [...ring];
  return ring.slice(-limit);
}

/** Subscribe to live log emissions. Returns a function to unsubscribe. */
export function subscribeLogs(handler: (line: LogLine) => void): () => void {
  emitter.on("line", handler);
  return () => emitter.off("line", handler);
}
