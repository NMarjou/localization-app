import { readFile } from "fs/promises";
import { join } from "path";
import { getLogger } from "./logger.js";
export class FileLoader {
    logger = getLogger();
    glossaryCache = new Map();
    tmCache = new Map();
    async loadGlossary(language) {
        const cacheKey = `glossary:${language}`;
        if (this.glossaryCache.has(cacheKey)) {
            this.logger.debug({ language }, "Returning cached glossary");
            return this.glossaryCache.get(cacheKey);
        }
        try {
            const filePath = join(process.cwd(), "locales", language, "glossary.json");
            this.logger.debug({ filePath }, "Loading glossary from file");
            const content = await readFile(filePath, "utf-8");
            const glossary = JSON.parse(content);
            this.glossaryCache.set(cacheKey, glossary);
            this.logger.debug({ language, terms: Object.keys(glossary).length }, "Glossary loaded");
            return glossary;
        }
        catch (error) {
            this.logger.warn({ language, error: error instanceof Error ? error.message : String(error) }, "Failed to load glossary, returning empty");
            return {};
        }
    }
    async loadTranslationMemory(language) {
        const cacheKey = `tm:${language}`;
        if (this.tmCache.has(cacheKey)) {
            this.logger.debug({ language }, "Returning cached translation memory");
            return this.tmCache.get(cacheKey);
        }
        try {
            const filePath = join(process.cwd(), "locales", language, "tm.json");
            this.logger.debug({ filePath }, "Loading translation memory from file");
            const content = await readFile(filePath, "utf-8");
            const tm = JSON.parse(content);
            this.tmCache.set(cacheKey, tm);
            this.logger.debug({ language, entries: tm.length }, "Translation memory loaded");
            return tm;
        }
        catch (error) {
            this.logger.warn({ language, error: error instanceof Error ? error.message : String(error) }, "Failed to load translation memory, returning empty");
            return [];
        }
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
}
let _fileLoader;
function getFileLoaderInstance() {
    if (!_fileLoader) {
        _fileLoader = new FileLoader();
    }
    return _fileLoader;
}
export { getFileLoaderInstance as fileLoader };
//# sourceMappingURL=file-loader.js.map