import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { getLogger } from "./logger.js";
/**
 * Try the full locale code first (e.g. "fr_FR"), then fall back to the
 * base language ("fr"). Handles both "fr_FR" and "fr-FR" separators.
 */
function candidateDirs(language) {
    const candidates = new Set();
    candidates.add(language);
    const base = language.split(/[-_]/)[0];
    if (base && base !== language)
        candidates.add(base);
    return [...candidates];
}
export class FileLoader {
    logger = getLogger();
    glossaryCache = new Map();
    tmCache = new Map();
    projectId;
    constructor(projectId) {
        this.projectId = projectId;
    }
    /**
     * Returns candidate base directories to search for locale files.
     * Tries project-namespaced paths first (locales/{projectId}/{lang}),
     * then falls back to legacy flat structure (locales/{lang}).
     */
    baseDirs(language) {
        const dirs = [];
        for (const lang of candidateDirs(language)) {
            if (this.projectId) {
                dirs.push(join(process.cwd(), "locales", this.projectId, lang));
            }
            dirs.push(join(process.cwd(), "locales", lang));
        }
        return dirs;
    }
    async loadGlossary(language) {
        const cacheKey = `glossary:${language}`;
        if (this.glossaryCache.has(cacheKey)) {
            this.logger.debug({ language }, "Returning cached glossary");
            return this.glossaryCache.get(cacheKey);
        }
        for (const dir of this.baseDirs(language)) {
            try {
                const filePath = join(dir, "glossary.json");
                this.logger.debug({ filePath }, "Loading glossary from file");
                const content = await readFile(filePath, "utf-8");
                const glossary = JSON.parse(content);
                this.glossaryCache.set(cacheKey, glossary);
                this.logger.debug({ language, dir, terms: Object.keys(glossary).length }, "Glossary loaded");
                return glossary;
            }
            catch {
                // Try next candidate
            }
        }
        this.logger.warn({ language, tried: this.baseDirs(language) }, "Failed to load glossary, returning empty");
        return {};
    }
    async loadTranslationMemory(language) {
        const cacheKey = `tm:${language}`;
        if (this.tmCache.has(cacheKey)) {
            this.logger.debug({ language }, "Returning cached translation memory");
            return this.tmCache.get(cacheKey);
        }
        for (const dir of this.baseDirs(language)) {
            try {
                const filePath = join(dir, "tm.json");
                this.logger.debug({ filePath }, "Loading translation memory from file");
                const content = await readFile(filePath, "utf-8");
                const tm = JSON.parse(content);
                this.tmCache.set(cacheKey, tm);
                this.logger.debug({ language, dir, entries: tm.length }, "Translation memory loaded");
                return tm;
            }
            catch {
                // Try next candidate
            }
        }
        this.logger.warn({ language, tried: this.baseDirs(language) }, "Failed to load translation memory, returning empty");
        return [];
    }
    clearCache(language) {
        if (language) {
            this.glossaryCache.delete(`glossary:${language}`);
            this.tmCache.delete(`tm:${language}`);
            this.logger.debug({ language }, "Cleared cache for language");
        }
        else {
            this.glossaryCache.clear();
            this.tmCache.clear();
            this.logger.debug("Cleared all caches");
        }
    }
    /**
     * Append a reviewed source→target pair to the TM file for the given
     * language. Dedupes — if the exact pair is already present, no-op.
     * Uses the same fallback directory lookup as loadTranslationMemory (so
     * a "fr_FR" update writes to "locales/fr/tm.json" if only the base
     * folder exists). If no folder exists yet, creates one at the full
     * locale code.
     */
    async appendTranslationMemoryEntry(language, entry) {
        if (!entry.source || !entry.target) {
            throw new Error("TM entry requires non-empty source and target");
        }
        // Find the existing TM file to update. Prefer the most specific directory.
        let filePath;
        for (const dir of this.baseDirs(language)) {
            const candidate = join(dir, "tm.json");
            if (existsSync(candidate)) {
                filePath = candidate;
                break;
            }
        }
        // No file yet — create it under project-namespaced path (or legacy if no projectId).
        if (!filePath) {
            const base = this.projectId
                ? join(process.cwd(), "locales", this.projectId, language)
                : join(process.cwd(), "locales", language);
            filePath = join(base, "tm.json");
            await mkdir(dirname(filePath), { recursive: true });
        }
        let tm = [];
        if (existsSync(filePath)) {
            const content = await readFile(filePath, "utf-8");
            tm = JSON.parse(content);
        }
        // Dedupe: exact source+target already present.
        const duplicate = tm.some((e) => e.source === entry.source && e.target === entry.target);
        if (duplicate) {
            this.logger.debug({ language, filePath, source: entry.source }, "TM entry already present, skipping");
            return { appended: false, filePath, total: tm.length };
        }
        tm.push(entry);
        await writeFile(filePath, JSON.stringify(tm, null, 2), "utf-8");
        // Invalidate in-memory cache so subsequent loads see the new entry.
        this.tmCache.delete(`tm:${language}`);
        for (const dir of candidateDirs(language)) {
            this.tmCache.delete(`tm:${dir}`);
        }
        this.logger.info({ language, filePath, total: tm.length }, "TM entry appended");
        return { appended: true, filePath, total: tm.length };
    }
}
const _fileLoaders = new Map();
function getFileLoaderInstance(projectId) {
    const key = projectId ?? "__default__";
    if (!_fileLoaders.has(key)) {
        _fileLoaders.set(key, new FileLoader(projectId));
    }
    return _fileLoaders.get(key);
}
export { getFileLoaderInstance as fileLoader };
//# sourceMappingURL=file-loader.js.map