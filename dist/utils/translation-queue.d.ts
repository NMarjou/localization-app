/**
 * Per-project debounced translation queue.
 *
 * Lokalise webhooks enqueue source keyIds here instead of triggering an
 * immediate translation. After a configurable idle window (or when a
 * size cap is hit), the queue flushes by invoking runBackfill() with
 * the queued keyIds — which uses the Batch API path (50% off) and
 * chunks 25 keys per Claude call. Net effect: ~10× cost cut versus the
 * legacy "per-key webhook → translate now" flow.
 *
 * State is in-memory. Server restart loses the queue; a per-project
 * cron flush (configured via `scheduledFallback` in projects.json)
 * acts as a safety net so nothing stays missed forever.
 */
export declare const DEFAULT_COALESCE_IDLE_MS: number;
export declare const DEFAULT_COALESCE_MAX_KEYS = 500;
/**
 * Lazy import to break the circular dependency between webhook handler,
 * backfill, and this module. We resolve `runBackfill` at flush time.
 */
type RunBackfill = (opts: import("../handlers/backfill.js").BackfillOptions) => Promise<unknown>;
export declare function setRunBackfill(fn: RunBackfill): void;
export declare function enqueueTranslation(projectId: string, keyId: number): {
    queued: boolean;
    queueSize: number;
    flushAt: number;
};
export declare function flush(projectId: string, reason: "idle" | "max-keys" | "scheduled" | "manual"): Promise<{
    submitted: boolean;
    keyIds: number[];
    reason: string;
} | null>;
export interface QueueState {
    projectId: string;
    size: number;
    lastEnqueueAt: number;
    flushAt: number;
    flushing: boolean;
}
export declare function getAllQueueStates(): QueueState[];
export declare function getQueueState(projectId: string): QueueState | null;
export {};
//# sourceMappingURL=translation-queue.d.ts.map