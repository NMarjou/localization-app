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
declare class RingStream extends Writable {
    _write(chunk: Buffer | string, _enc: BufferEncoding, cb: (err?: Error | null) => void): void;
}
/** Singleton stream registered with pino.multistream in logger.ts. */
export declare const logRingStream: RingStream;
/** Snapshot of the most recent N log lines (newest last). */
export declare function recentLogs(limit?: number): LogLine[];
/** Subscribe to live log emissions. Returns a function to unsubscribe. */
export declare function subscribeLogs(handler: (line: LogLine) => void): () => void;
export {};
//# sourceMappingURL=log-buffer.d.ts.map