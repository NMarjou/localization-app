const fs = require("fs");
const path = require("path");
const xml2js = require("xml2js");
const glob = require("glob");

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

const BASE_PATH = path.resolve(".");
const TM_DIR = path.join(BASE_PATH, "TMs");
const GLOSSARIES_DIR = path.join(BASE_PATH, "Glossaries");
const LOCALES_DIR = path.join(BASE_PATH, "locales");

async function parseTMX(filePath, targetLang) {
  const xml = fs.readFileSync(filePath, "utf-8");
  const parser = new xml2js.Parser();
  const json = await parser.parseStringPromise(xml);

  const tm = {};
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
      tm[source] = target;
    }
  }

  return tm;
}

function parseCSV(filePath, targetLang) {
  const csv = fs.readFileSync(filePath, "utf-8");
  const lines = csv.split("\n");
  const headers = lines[0].split(";");

  const sourceIdx = headers.indexOf("en-US");
  const targetIdx = headers.indexOf(targetLang.replace("-", "_"));

  if (sourceIdx === -1 || targetIdx === -1) {
    console.warn(
      `Could not find columns for en-US or ${targetLang} in ${filePath}`
    );
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

  const tmxFiles = glob.sync(path.join(TM_DIR, "*.tmx"));
  const csvFiles = glob.sync(path.join(GLOSSARIES_DIR, "*.csv"));

  const languagePairs = new Set();

  for (const file of tmxFiles) {
    const filename = path.basename(file);
    const match = filename.match(/en-US_(.+)\.tmx/);
    if (match) {
      languagePairs.add(match[1]);
    }
  }

  console.log(
    `Found ${languagePairs.size} language pairs: ${Array.from(languagePairs).join(", ")}\n`
  );

  for (const langPair of languagePairs) {
    const targetLang = langPair;
    const mappedLang = LANGUAGE_MAP[targetLang] || targetLang.toLowerCase();

    console.log(`Processing ${targetLang} (mapped to '${mappedLang}')...`);

    const localeDir = path.join(LOCALES_DIR, mappedLang);
    fs.mkdirSync(localeDir, { recursive: true });

    const tmxFile = path.join(TM_DIR, `en-US_${targetLang}.tmx`);
    if (fs.existsSync(tmxFile)) {
      try {
        const tm = await parseTMX(tmxFile, targetLang);
        const tmPath = path.join(localeDir, "tm.json");
        fs.writeFileSync(tmPath, JSON.stringify(tm, null, 2));
        console.log(`  ✓ TM: ${Object.keys(tm).length} entries`);
      } catch (error) {
        console.error(`  ✗ TMX parse failed:`, error.message);
      }
    }

    const csvFile = path.join(
      GLOSSARIES_DIR,
      `glossary_en-US_${targetLang}.csv`
    );
    if (fs.existsSync(csvFile)) {
      try {
        const glossary = parseCSV(csvFile, targetLang);
        const glossaryPath = path.join(localeDir, "glossary.json");
        fs.writeFileSync(glossaryPath, JSON.stringify(glossary, null, 2));
        console.log(`  ✓ Glossary: ${Object.keys(glossary).length} terms`);
      } catch (error) {
        console.error(`  ✗ CSV parse failed:`, error.message);
      }
    }
  }

  console.log("\n✅ Import complete!");
  console.log(`Loaded into: ${LOCALES_DIR}`);
}

importAll().catch((error) => {
  console.error("❌ Import failed:", error);
  process.exit(1);
});
