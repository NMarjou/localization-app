#!/usr/bin/env node
/**
 * Remove duplicate cost-log entries for the same (jobId).
 *
 * Why: a poll-loop bug used to re-fetch and re-record the same batch
 * results every 30 s, inflating the cost log by 10×+ for affected
 * batches. Anthropic only charged once; only our local accounting was
 * wrong. This script reduces each (jobId) to a single entry — keeping
 * the FIRST occurrence so timestamps / token counts match the original
 * billable event.
 *
 * Usage:
 *   node scripts/dedupe-cost-log.mjs
 *
 * Writes data/cost-log.jsonl.before-dedupe as a backup. Idempotent.
 */

import { readFile, writeFile, copyFile, stat } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

const LOG_PATH = join(process.cwd(), "data", "cost-log.jsonl");
const BACKUP_PATH = LOG_PATH + ".before-dedupe";

if (!existsSync(LOG_PATH)) {
  console.error(`Cost log not found at ${LOG_PATH}`);
  process.exit(1);
}

const before = await stat(LOG_PATH);
const raw = await readFile(LOG_PATH, "utf-8");
const lines = raw.split("\n").filter((l) => l.trim().length > 0);

const seen = new Set();
const kept = [];
let dupes = 0;
let parseErrors = 0;

for (const line of lines) {
  try {
    const entry = JSON.parse(line);
    const key = entry.jobId;
    if (!key) {
      // No jobId — keep the line (treat as unique)
      kept.push(line);
      continue;
    }
    if (seen.has(key)) {
      dupes++;
      continue;
    }
    seen.add(key);
    kept.push(line);
  } catch {
    parseErrors++;
    // Keep malformed lines as-is (don't lose data)
    kept.push(line);
  }
}

if (dupes === 0) {
  console.log(`No duplicates found. (${lines.length} entries scanned.)`);
  process.exit(0);
}

await copyFile(LOG_PATH, BACKUP_PATH);
await writeFile(LOG_PATH, kept.join("\n") + "\n", "utf-8");

const after = await stat(LOG_PATH);

console.log(`✓ Deduped cost log:`);
console.log(`  Lines before:    ${lines.length}`);
console.log(`  Lines after:     ${kept.length}`);
console.log(`  Duplicates:      ${dupes}`);
if (parseErrors > 0) {
  console.log(`  Parse errors:    ${parseErrors} (kept as-is)`);
}
console.log(`  Size before:     ${before.size.toLocaleString()} bytes`);
console.log(`  Size after:      ${after.size.toLocaleString()} bytes`);
console.log(`  Backup written:  ${BACKUP_PATH}`);
