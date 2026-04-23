import { type ScheduledTask } from "node-cron";
/**
 * Start the periodic backfill job. Defaults to every 4 hours (top of hour:
 * 00:00, 04:00, 08:00, 12:00, 16:00, 20:00). Override via BACKFILL_CRON env var.
 *
 * The job invokes the same runBackfill as the manual POST /trigger/backfill
 * endpoint, so behaviour stays identical between the two paths.
 *
 * Caveat: node-cron runs in-process — if the machine is asleep at a
 * scheduled time, that run is simply missed (the next run still fires).
 */
export declare function startScheduler(): ScheduledTask;
//# sourceMappingURL=scheduler.d.ts.map