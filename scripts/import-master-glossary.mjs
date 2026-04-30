#!/usr/bin/env node
/**
 * Convert a master glossary CSV into the project-wide glossary.json
 * format used by the service.
 *
 * Usage:
 *   node scripts/import-master-glossary.mjs \
 *     --project <projectId> \
 *     --input <path-to-csv> \
 *     [--source en-US] \
 *     [--out locales/<projectId>/glossary.json]
 *
 * The CSV must have a header row. Any column whose header looks like an
 * ISO language code (e.g. "en-US", "fr-FR", "ja", "translations.nl") is
 * treated as a translation column. Everything else is ignored.
 *
 * Output format:
 *   {
 *     "source": "en",
 *     "terms": [
 *       { "en": "Feedback", "fr": "Feedback", "de": "Feedback" },
 *       ...
 *     ]
 *   }
 *
 * The runtime resolves "fr-FR" / "fr" / "translations.fr" to the same
 * column via fallback, so you can keep keys in whichever form is most
 * convenient. By default we normalize full codes ("fr-FR") to base
 * codes ("fr") so files stay short.
 */

import { readFile, mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { resolve, dirname, join } from "path";

const argv = process.argv.slice(2);
function arg(name, fallback) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}` && argv[i + 1]) return argv[i + 1];
    const m = argv[i].match(new RegExp(`^--${name}=(.+)$`));
    if (m) return m[1];
  }
  return fallback;
}

const projectId = arg("project");
const inputPath = arg("input");
const sourceArg = arg("source", "en-US");
const outArg = arg("out");
const keepFullCodes = argv.includes("--keep-full-codes");

if (!projectId || !inputPath) {
  console.error(
    "Usage: node scripts/import-master-glossary.mjs --project <id> --input <csv> [--source en-US] [--out <path>] [--keep-full-codes]"
  );
  process.exit(1);
}

const repoRoot = resolve(process.cwd());
const csvPath = resolve(inputPath);
const outPath = outArg
  ? resolve(outArg)
  : join(repoRoot, "locales", projectId, "glossary.json");

if (!existsSync(csvPath)) {
  console.error(`Input not found: ${csvPath}`);
  process.exit(1);
}

/**
 * Minimal CSV parser that handles quoted fields with embedded commas,
 * escaped double-quotes ("") and CRLF line endings. Avoids pulling in
 * a dependency.
 */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function isLanguageColumn(header) {
  // Bare ISO 639-1 (e.g. "fr"), full IETF-ish (e.g. "fr-FR" / "fr_FR"),
  // or Lokalise custom-prefix codes (e.g. "translations.nl-NL").
  return /^([a-z]{2,3}([-_][A-Z]{2})?|[\w-]+\.[a-z]{2,3}([-_][A-Z]{2})?)$/.test(
    header.trim()
  );
}

function dropPrefix(header) {
  return header.includes(".") ? header.split(".").pop() : header;
}

function baseCode(header) {
  return dropPrefix(header).split(/[-_]/)[0];
}

/**
 * Build a header → output-key map. Default is to collapse "fr-FR" → "fr"
 * for shorter JSON keys, BUT if two source columns share the same base
 * (e.g. en-US + en-GB → both collapse to "en"), we keep them as full
 * codes to avoid silently merging two distinct languages.
 */
function buildCodeMap(headers) {
  const langHeaders = headers.filter(isLanguageColumn);
  const baseToHeaders = new Map();
  for (const h of langHeaders) {
    const b = baseCode(h);
    if (!baseToHeaders.has(b)) baseToHeaders.set(b, []);
    baseToHeaders.get(b).push(h);
  }
  const map = new Map();
  for (const [base, hs] of baseToHeaders) {
    if (keepFullCodes || hs.length > 1) {
      // Collision (or user opted in) → keep each header as its full code
      // (still strip the optional prefix part, e.g. "translations.fr-FR" → "fr-FR").
      for (const h of hs) map.set(h, dropPrefix(h));
    } else {
      // Singleton → safe to collapse to base ISO 639-1
      map.set(hs[0], base);
    }
  }
  return map;
}

function normalizeSource(code) {
  // Source code: prefer the same logic as the column map. Always drop the
  // prefix; collapse to base unless --keep-full-codes is set.
  const noPrefix = dropPrefix(code);
  return keepFullCodes ? noPrefix : noPrefix.split(/[-_]/)[0];
}

const text = await readFile(csvPath, "utf-8");
const rows = parseCSV(text).filter((r) => r.length > 0 && r.some((c) => c.trim() !== ""));

if (rows.length < 2) {
  console.error("CSV has fewer than 2 rows (need at least header + 1 data row)");
  process.exit(1);
}

const headers = rows[0].map((h) => h.trim());
const langCols = headers
  .map((h, idx) => ({ header: h, idx }))
  .filter(({ header }) => isLanguageColumn(header));

if (langCols.length === 0) {
  console.error("No language columns detected in CSV header. Headers seen:");
  console.error("  " + headers.join(", "));
  process.exit(1);
}

const codeMap = buildCodeMap(headers);
// Determine the JSON key for the source — either the mapped key for the
// source column header, or the normalized form of sourceArg if it isn't
// itself a column header (rare; e.g. user passed "en" but column is "en-US").
const sourceCode = codeMap.get(sourceArg) ?? normalizeSource(sourceArg);

const terms = [];
const langCounts = {};

for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  const term = {};
  for (const { header, idx } of langCols) {
    const v = (row[idx] ?? "").trim();
    if (!v) continue;
    const key = codeMap.get(header) ?? header;
    term[key] = v;
    langCounts[key] = (langCounts[key] || 0) + 1;
  }
  // Only keep rows that have at least the source value
  if (term[sourceCode]) terms.push(term);
}

const doc = { source: sourceCode, terms };
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(doc, null, 2), "utf-8");

console.log(`✓ Wrote ${outPath}`);
console.log(`  Source language: ${sourceCode}`);
console.log(`  Terms: ${terms.length}`);
console.log(`  Languages:`);
for (const [code, count] of Object.entries(langCounts).sort()) {
  console.log(`    ${code.padEnd(8)} ${count} terms`);
}
const dropped = rows.length - 1 - terms.length;
if (dropped > 0) {
  console.log(`  Dropped ${dropped} row(s) with no source value (column "${sourceArg}")`);
}
