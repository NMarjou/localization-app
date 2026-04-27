#!/usr/bin/env node
/**
 * Seed a project's locale folder from locales/_template.
 *
 * Usage:
 *   node scripts/seed-project-locales.mjs <projectId> [--force]
 *
 * Copies every language sub-folder under locales/_template/ into
 * locales/<projectId>/. By default it refuses to overwrite existing files;
 * pass --force to overwrite.
 */

import { cp, mkdir, readdir, stat } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve } from "path";

const argv = process.argv.slice(2);
const force = argv.includes("--force");
const positional = argv.filter((a) => !a.startsWith("--"));

if (positional.length !== 1) {
  console.error("Usage: node scripts/seed-project-locales.mjs <projectId> [--force]");
  process.exit(1);
}

const projectId = positional[0];
const repoRoot = resolve(process.cwd());
const templateDir = join(repoRoot, "locales", "_template");
const targetDir = join(repoRoot, "locales", projectId);

if (!existsSync(templateDir)) {
  console.error(`Template directory not found: ${templateDir}`);
  process.exit(1);
}

const templateStat = await stat(templateDir);
if (!templateStat.isDirectory()) {
  console.error(`Template path is not a directory: ${templateDir}`);
  process.exit(1);
}

await mkdir(targetDir, { recursive: true });

const langs = (await readdir(templateDir, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

if (langs.length === 0) {
  console.error(`No language folders found in ${templateDir}`);
  process.exit(1);
}

let copied = 0;
for (const lang of langs) {
  const src = join(templateDir, lang);
  const dest = join(targetDir, lang);
  if (existsSync(dest) && !force) {
    console.warn(`Skipping ${lang}: ${dest} already exists (use --force to overwrite)`);
    continue;
  }
  await cp(src, dest, { recursive: true, force });
  copied++;
  console.log(`✓ ${lang} → ${dest}`);
}

console.log(`\nSeeded ${copied}/${langs.length} languages into locales/${projectId}/`);
