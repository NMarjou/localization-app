#!/usr/bin/env node
/**
 * Trim a glossary file by removing low-value entries.
 *
 * Usage:
 *   node scripts/trim-glossary.mjs <path-to-glossary.json>
 *
 * Rules (applied in order; first match wins):
 *   1. source === target               → KEEP   (explicit "translates to itself" pin,
 *                                                e.g. "Feedback" → "Feedback")
 *   2. brand-like / camelCase / ACRONYM→ KEEP   (e.g. "PayAnalytics", "API", "iOS")
 *   3. length < 4                      → DROP   (too generic)
 *   4. single-word common UI term      → DROP   (e.g. "about", "save", "cancel")
 *   5. multi-word phrase of stopwords  → DROP   (e.g. "click here", "log out")
 *   6. otherwise                       → KEEP
 *
 * Writes <input-stem>.trimmed.json next to the original. Review the diff,
 * then `mv` the trimmed file over the original to apply.
 */

import { readFile, writeFile } from "fs/promises";
import { resolve, dirname, join, basename } from "path";

// Common UI / English vocabulary that Claude translates correctly without
// explicit glossary rules. Single-word entries here get dropped.
const COMMON_WORDS = new Set([
  // Navigation / UI controls
  "about", "advanced", "back", "cancel", "close", "collapse", "continue",
  "default", "done", "edit", "expand", "filter", "filters", "go",
  "help", "hide", "home", "menu", "next", "open", "previous", "refresh",
  "reset", "restart", "restore", "resume", "retry", "search", "settings",
  "show", "sort", "stop", "toggle", "view",

  // CRUD verbs
  "add", "added", "addition", "additional", "addnew", "apply", "applied",
  "approve", "approved", "archive", "archived", "create", "created",
  "delete", "deleted", "duplicate", "edit", "edited", "modify", "modified",
  "remove", "removed", "save", "saved", "submit", "submitted", "update",
  "updated", "updates",

  // Generic field labels
  "active", "all", "available", "data", "date", "description", "details",
  "disabled", "empty", "enabled", "field", "fields", "group", "groups",
  "inactive", "info", "information", "input", "item", "items", "kind",
  "label", "labels", "list", "lists", "more", "name", "names", "none",
  "number", "numbers", "optional", "page", "pages", "required", "row",
  "rows", "section", "sections", "status", "step", "steps", "summary",
  "table", "tables", "tag", "tags", "time", "times", "title", "titles",
  "total", "type", "types", "value", "values",

  // Generic action verbs/adjectives
  "accept", "accepted", "accepting", "action", "actions", "activate",
  "alert", "alerts", "answer", "answers", "assign", "assigned", "before",
  "after", "begin", "begins", "browse", "build", "built", "change",
  "changes", "chart", "check", "checked", "checks", "choose", "chosen",
  "click", "clicked", "comment", "comments", "company", "complete",
  "completed", "configure", "configured", "confirm", "confirmed", "copy",
  "count", "counts", "current", "currently", "custom", "decline",
  "declined", "deselect", "disable", "disabled", "dismiss", "download",
  "downloaded", "draft", "drafts", "drop", "drops", "enable", "ended",
  "enter", "entered", "explore", "export", "exported", "fail", "failed",
  "finish", "finished", "forward", "future", "general", "generate",
  "generated", "import", "imported", "include", "included", "increase",
  "join", "joined", "language", "languages", "leave", "left", "library",
  "load", "loaded", "loading", "lock", "locked", "login", "logout",
  "manage", "managed", "manager", "match", "matches", "missing", "modify",
  "modified", "month", "months", "move", "moved", "mute", "muted", "new",
  "old", "opt", "option", "options", "order", "ordered", "overview",
  "paid", "panel", "past", "pause", "paused", "pending", "permission",
  "permissions", "personal", "place", "placed", "play", "played",
  "preview", "private", "progress", "public", "publish", "published",
  "rate", "rated", "reason", "reasons", "receive", "received", "recent",
  "register", "registered", "release", "released", "renew", "renewed",
  "repeat", "repeated", "report", "reports", "request", "requests",
  "reward", "rewards", "role", "roles", "save", "schedule", "scheduled",
  "search", "select", "selected", "send", "sent", "share", "shared",
  "sign", "signed", "skip", "skipped", "specific", "start", "started",
  "starts", "status", "stop", "stopped", "store", "stored", "submit",
  "submitted", "subscribe", "subscribed", "summary", "support",
  "suspend", "suspended", "switch", "team", "teams", "test", "tested",
  "today", "tomorrow", "track", "tracked", "tracking", "training",
  "transfer", "transferred", "try", "trying", "unlock", "unlocked",
  "unmute", "unsubscribe", "unselect", "unselected", "upload", "uploaded",
  "user", "users", "vote", "voted", "wait", "waiting", "watch", "watched",
  "week", "weeks", "year", "yearly", "years", "yesterday",

  // Generic deictics / conjunctions / prepositions
  "an", "and", "are", "at", "be", "been", "but", "by", "can", "could",
  "did", "do", "does", "for", "from", "has", "have", "in", "into", "is",
  "it", "its", "of", "on", "or", "the", "this", "that", "these", "those",
  "to", "was", "were", "will", "with", "without", "would", "you", "your",

  // Time / quantity
  "always", "any", "anyone", "anything", "before", "between", "both",
  "every", "everyone", "everything", "few", "first", "last", "later",
  "many", "most", "much", "never", "no", "now", "often", "once", "only",
  "other", "others", "rarely", "same", "second", "seldom", "several",
  "since", "some", "someone", "something", "sometimes", "third", "until",
  "whenever", "yes",

  // Auth / common UI containers
  "dialog", "footer", "header", "logout", "login", "main", "modal",
  "navbar", "panel", "popup", "signin", "signout", "signup", "tab",
  "toolbar", "tooltip", "window",

  // Boolean-flavored
  "true", "false", "off", "on",

  // Direction / position
  "up", "down", "left", "right", "out", "in",

  // Common business
  "account", "accounts", "address", "city", "code", "country", "email",
  "employee", "employees", "file", "files", "first", "folder", "folders",
  "image", "images", "last", "phone", "photo", "photos", "title", "users",
  "video", "videos", "zip",
]);

/**
 * True if the term contains an uppercase letter mid-word (camelCase) or
 * is fully uppercase (acronym). Helps identify product/brand names.
 */
function isBrandLike(text) {
  const words = text.split(/\s+/);
  return words.some((w) => {
    if (!w) return false;
    // ACRONYM: 2+ uppercase letters in a row anywhere
    if (/[A-Z]{2,}/.test(w)) return true;
    // camelCase: lowercase letter followed by uppercase
    if (/[a-z][A-Z]/.test(w)) return true;
    return false;
  });
}

/**
 * True if every word in `text` is a common stopword (case-insensitive).
 * Used to drop multi-word "click here" / "log out" type entries.
 */
function isAllStopwords(text) {
  const words = text.toLowerCase().match(/[a-z]+/g) || [];
  if (words.length === 0) return false;
  return words.every((w) => COMMON_WORDS.has(w));
}

function shouldKeep(source, target) {
  const trimmed = source.trim();

  // Rule 1: explicit "translates to itself" pin
  if (source === target) return true;

  // Rule 2: brand-like → keep regardless of length
  if (isBrandLike(trimmed)) return true;

  // Rule 3: too short
  if (trimmed.length < 4) return false;

  // Rule 4: single-word common UI term
  const lower = trimmed.toLowerCase();
  if (!trimmed.includes(" ") && COMMON_WORDS.has(lower)) return false;

  // Rule 5: multi-word of stopwords
  if (trimmed.includes(" ") && isAllStopwords(trimmed)) return false;

  return true;
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: node scripts/trim-glossary.mjs <path-to-glossary.json>");
    process.exit(1);
  }

  const fullPath = resolve(inputPath);
  const original = JSON.parse(await readFile(fullPath, "utf-8"));

  const before = Object.keys(original).length;
  const trimmed = {};
  const dropped = [];

  for (const [source, target] of Object.entries(original)) {
    if (shouldKeep(source, target)) {
      trimmed[source] = target;
    } else {
      dropped.push(source);
    }
  }

  const dir = dirname(fullPath);
  const base = basename(fullPath, ".json");
  const outPath = join(dir, `${base}.trimmed.json`);

  await writeFile(outPath, JSON.stringify(trimmed, null, 2), "utf-8");

  const after = Object.keys(trimmed).length;
  console.log(`\n✓ ${inputPath}`);
  console.log(`  Before: ${before} terms`);
  console.log(`  After:  ${after} terms (${dropped.length} removed)`);
  console.log(`  Output: ${outPath}`);

  // Show a sample of dropped entries so user can sanity-check
  const sampleSize = Math.min(15, dropped.length);
  if (sampleSize > 0) {
    console.log(`\n  Sample of removed entries:`);
    for (const term of dropped.slice(0, sampleSize)) {
      console.log(`    - ${term}`);
    }
    if (dropped.length > sampleSize) {
      console.log(`    … and ${dropped.length - sampleSize} more`);
    }
  }

  console.log(`\nReview the diff, then to apply:`);
  console.log(`  mv ${outPath} ${fullPath}`);
}

main().catch((err) => {
  console.error("Trim failed:", err);
  process.exit(1);
});
