import cron from "node-cron";
import { getLogger } from "./utils/logger.js";
import { runBackfill } from "./handlers/backfill.js";

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
export function startScheduler(): cron.ScheduledTask {
  const logger = getLogger();
  const expression = process.env.BACKFILL_CRON?.trim() || "0 */4 * * *";

  if (!cron.validate(expression)) {
    throw new Error(
      `Invalid BACKFILL_CRON expression: "${expression}" (must be a valid 5-field cron)`
    );
  }

  logger.info(
    { cron: expression, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    "Scheduling periodic backfill"
  );

  const task = cron.schedule(expression, async () => {
    logger.info({ cron: expression }, "Scheduled backfill tick");
    try {
      const summary = await runBackfill();
      logger.info({ ...summary }, "Scheduled backfill finished");
    } catch (err) {
      logger.error(
        { error: err instanceof Error ? err.message : String(err) },
        "Scheduled backfill threw"
      );
    }
  });

  return task;
}
