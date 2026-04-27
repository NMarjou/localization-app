import fs from "fs";
import path from "path";
import xml2js from "xml2js";
import { glob } from "glob";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Language code mappings
const LANGUAGE_MAP = {
  "en-US": "en",
  "en-GB": "en",
  "fr-FR": "fr",
  "de-DE": "de",
  "es-ES": "es",
  "it-IT": "it",
  "pt-PT": "pt",
  "ja-JP": "ja",
  "nl-NL": "nl",
  "th-TH": "th",
  "id-ID": "id",
  "tr-TR": "tr",
};

const BASE_PATH = path.resolve(path.join(__dirname, ".."));
const TM_DIR = path.join(BASE_PATH, "TMs");
const GLOSSARIES_DIR = path.join(BASE_PATH, "Glossaries");

// Resolve --project arg. Writes go to locales/{projectId}/{lang}/* when set,
// otherwise fall back to the shared template at locales/_template/{lang}/*.
// The template is the seed copied to a new project's namespace via
// scripts/seed-project-locales.mjs and isn't read at runtime.
const argv = process.argv.slice(2);
let projectId;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--project" && argv[i + 1]) {
    projectId = argv[i + 1];
    break;
  }
  const m = argv[i].match(/^--project=(.+)$/);
  if (m) {
    projectId = m[1];
    break;
  }
}
const LOCALES_DIR = projectId
  ? path.join(BASE_PATH, "locales", projectId)
  : path.join(BASE_PATH, "locales", "_template");

async function parseTMX(filePath, targetLang) {
  const xmlContent = fs.readFileSync(filePath, "utf-8");
  const parser = new xml2js.Parser();
  const json = await parser.parseStringPromise(xmlContent);

  const tm = [];
  const units = json.tmx?.body?.[0]?.tu || [];

  for (const unit of units) {
    const tuvs = unit.tuv || [];
    let source = "";
    let target = "";

    for (const tuv of tuvs) {
      const lang = tuv.$?.["xml:lang"] || "";
      const segment = tuv.seg?.[0] || "";

      if (lang === "en-US") {
        source = segment;
      } else if (lang === targetLang) {
        target = segment;
      }
    }

    if (source && target) {
      tm.push({ source, target });
    }
  }

  return tm;
}

function parseCSV(filePath, targetLang) {
  const csv = fs.readFileSync(filePath, "utf-8");
  const lines = csv.split("\n");
  const headers = lines[0].split(";");

  const sourceIdx = headers.indexOf("en-US");
  // CSV uses underscores (e.g., fr_FR) instead of hyphens (e.g., fr-FR)
  const csvLangCode = targetLang.replace("-", "_");
  const targetIdx = headers.indexOf(csvLangCode);

  if (sourceIdx === -1 || targetIdx === -1) {
    return {};
  }

  const glossary = {};

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(";");
    const source = parts[sourceIdx]?.trim();
    const target = parts[targetIdx]?.trim();

    if (source && target) {
      glossary[source] = target;
    }
  }

  return glossary;
}

async function importAll() {
  console.log("🔄 Importing translation memories and glossaries...\n");
  console.log(
    projectId
      ? `Target: locales/${projectId}/ (project namespace)\n`
      : `Target: locales/_template/ (shared seed; no --project specified)\n`
  );

  const tmxFiles = await glob(path.join(TM_DIR, "*.tmx"));
  const languagePairs = new Set();

  for (const file of tmxFiles) {
    const filename = path.basename(file);
    const match = filename.match(/en-US_(.+)\.tmx/);
    if (match) {
      languagePairs.add(match[1]);
    }
  }

  const sortedPairs = Array.from(languagePairs).sort();
  console.log(
    `Found ${languagePairs.size} language pairs: ${sortedPairs.join(", ")}\n`
  );

  let totalTMEntries = 0;
  let totalGlossaryTerms = 0;

  for (const langPair of sortedPairs) {
    const targetLang = langPair;
    const mappedLang = LANGUAGE_MAP[targetLang] || targetLang.toLowerCase();

    console.log(`Processing ${targetLang} (→ '${mappedLang}')...`);

    const localeDir = path.join(LOCALES_DIR, mappedLang);
    fs.mkdirSync(localeDir, { recursive: true });

    // Parse TMX
    const tmxFile = path.join(TM_DIR, `en-US_${targetLang}.tmx`);
    if (fs.existsSync(tmxFile)) {
      try {
        const tm = await parseTMX(tmxFile, targetLang);
        const tmPath = path.join(localeDir, "tm.json");
        fs.writeFileSync(tmPath, JSON.stringify(tm, null, 2));
        const count = Object.keys(tm).length;
        totalTMEntries += count;
        console.log(`  ✓ TM: ${count} entries`);
      } catch (error) {
        console.error(`  ✗ TMX parse failed:`, error.message);
      }
    }

    // Parse CSV glossary
    const csvFile = path.join(
      GLOSSARIES_DIR,
      `glossary_en-US_${targetLang}.csv`
    );
    if (fs.existsSync(csvFile)) {
      try {
        const glossary = parseCSV(csvFile, targetLang);
        const glossaryPath = path.join(localeDir, "glossary.json");
        fs.writeFileSync(glossaryPath, JSON.stringify(glossary, null, 2));
        const count = Object.keys(glossary).length;
        totalGlossaryTerms += count;
        console.log(`  ✓ Glossary: ${count} terms`);
      } catch (error) {
        console.error(`  ✗ CSV parse failed:`, error.message);
      }
    }
  }

  console.log("\n✅ Import complete!");
  console.log(`\n📊 Summary:`);
  console.log(`  • Languages: ${sortedPairs.length}`);
  console.log(`  • Total TM entries: ${totalTMEntries.toLocaleString()}`);
  console.log(`  • Total glossary terms: ${totalGlossaryTerms.toLocaleString()}`);
  console.log(`  • Loaded into: ${LOCALES_DIR}`);
}

importAll().catch((error) => {
  console.error("❌ Import failed:", error);
  process.exit(1);
});
