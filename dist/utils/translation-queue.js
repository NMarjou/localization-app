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
import { getProject } from "../config/projects.js";
import { getLogger } from "./logger.js";
export const DEFAULT_COALESCE_IDLE_MS = 10 * 60 * 1000; // 10 min
export const DEFAULT_COALESCE_MAX_KEYS = 500;
const queues = new Map();
let runBackfillRef = null;
export function setRunBackfill(fn) {
    runBackfillRef = fn;
}
function logger() {
    return getLogger();
}
function ensureEntry(projectId) {
    let entry = queues.get(projectId);
    if (!entry) {
        entry = {
            keys: new Set(),
            lastEnqueueAt: Date.now(),
            flushAt: 0,
            flushing: false,
        };
        queues.set(projectId, entry);
    }
    return entry;
}
export function enqueueTranslation(projectId, keyId) {
    const project = getProject(projectId);
    if (!project)
        return { queued: false, queueSize: 0, flushAt: 0 };
    const idleMs = project.coalesceIdleMs ?? DEFAULT_COALESCE_IDLE_MS;
    const maxKeys = project.coalesceMaxKeys ?? DEFAULT_COALESCE_MAX_KEYS;
    const entry = ensureEntry(projectId);
    entry.keys.add(keyId);
    entry.lastEnqueueAt = Date.now();
    if (entry.idleTimer)
        clearTimeout(entry.idleTimer);
    entry.flushAt = Date.now() + idleMs;
    entry.idleTimer = setTimeout(() => {
        void flush(projectId, "idle");
    }, idleMs);
    // Don't keep the process alive purely for this timer — relevant for tests.
    entry.idleTimer.unref?.();
    if (entry.keys.size >= maxKeys) {
        logger().info({ projectId, queueSize: entry.keys.size, maxKeys }, "Translation queue hit max-keys cap — flushing immediately");
        // Fire-and-forget; setImmediate so caller returns before the heavy work.
        setImmediate(() => void flush(projectId, "max-keys"));
    }
    return { queued: true, queueSize: entry.keys.size, flushAt: entry.flushAt };
}
export async function flush(projectId, reason) {
    const entry = queues.get(projectId);
    if (!entry || entry.keys.size === 0)
        return null;
    if (entry.flushing) {
        logger().debug({ projectId, queueSize: entry.keys.size, reason }, "Flush requested while another flush is in flight — skipped");
        return null;
    }
    entry.flushing = true;
    if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
        entry.idleTimer = undefined;
    }
    entry.flushAt = 0;
    // Snapshot + clear so any new enqueues during the flush start a fresh queue
    const keyIds = Array.from(entry.keys);
    entry.keys.clear();
    logger().info({ projectId, keyCount: keyIds.length, reason }, "Flushing translation queue");
    try {
        if (!runBackfillRef) {
            logger().error({ projectId }, "runBackfill not registered — translation queue cannot flush");
            // Re-add the keys so we don't lose them
            for (const k of keyIds)
                entry.keys.add(k);
            return null;
        }
        await runBackfillRef({
            projectId,
            keyIds,
            // The user explicitly proofread these → they want them translated
            // regardless of staleness. Force=true matches that expectation.
            force: true,
        });
        return { submitted: true, keyIds, reason };
    }
    catch (err) {
        logger().error({
            projectId,
            keyCount: keyIds.length,
            error: err instanceof Error ? err.message : String(err),
        }, "Translation queue flush failed");
        // Best-effort recovery: re-add the keys so the next flush retries.
        for (const k of keyIds)
            entry.keys.add(k);
        return null;
    }
    finally {
        entry.flushing = false;
    }
}
export function getAllQueueStates() {
    return Array.from(queues.entries()).map(([projectId, entry]) => ({
        projectId,
        size: entry.keys.size,
        lastEnqueueAt: entry.lastEnqueueAt,
        flushAt: entry.flushAt,
        flushing: entry.flushing,
    }));
}
export function getQueueState(projectId) {
    const entry = queues.get(projectId);
    if (!entry)
        return null;
    return {
        projectId,
        size: entry.keys.size,
        lastEnqueueAt: entry.lastEnqueueAt,
        flushAt: entry.flushAt,
        flushing: entry.flushing,
    };
}
//# sourceMappingURL=translation-queue.js.map