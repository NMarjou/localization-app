import { getEnv } from "../config/env.js";
import { getLogger } from "../utils/logger.js";
import { LokaliseError } from "../utils/errors.js";
import { HttpClient } from "./http.js";
import type {
  LokaliseKey,
  KeyWithContext,
  Glossary,
  GlossaryTerm,
  ListKeysFilters,
  LokaliseKeysResponse,
  LokaliseKeyResponse,
  LokaliseGlossaryResponse,
} from "../types/lokalise.js";

export class LokaliseClient {
  private http: HttpClient;
  private projectId: string;
  private logger: ReturnType<typeof getLogger>;
  private glossaryCache: Map<string, Glossary> = new Map();
  private baseLanguageIso?: string;
  // Short-TTL cache + in-flight dedupe for listKeys. When a single source
  // update fans out to N target languages we'd otherwise hit listKeys N
  // times simultaneously and get rate-limited.
  private listKeysCache?: { at: number; keys: LokaliseKey[]; cacheKey: string };
  private listKeysInFlight?: {
    cacheKey: string;
    promise: Promise<LokaliseKey[]>;
  };
  private keyCache: Map<string, { at: number; key: LokaliseKey }> = new Map();
  private keyInFlight: Map<string, Promise<LokaliseKey>> = new Map();
  private static LIST_KEYS_TTL_MS = 60_000;
  private static KEY_TTL_MS = 60_000;

  constructor() {
    const env = getEnv();
    this.projectId = env.LOKALISE_PROJECT_ID;
    this.logger = getLogger();

    this.http = new HttpClient({
      baseUrl: "https://api.lokalise.com/api2/",
      apiKey: env.LOKALISE_API_KEY,
      maxRetries: 3,
      retryDelay: 1000,
    });
  }

  async getKey(keyId: string, language?: string): Promise<LokaliseKey> {
    this.logger.debug({ keyId, language }, "Fetching key");

    try {
      const path = `/projects/${this.projectId}/keys/${keyId}`;
      const params: Record<string, unknown> = {};

      if (language) {
        params.include_translations = 1;
        params.filter_langs = language;
      }

      const response = await this.http.get<LokaliseKeyResponse>(path, params);

      return response.key;
    } catch (error) {
      if (error instanceof LokaliseError && error.statusCode === 404) {
        throw new LokaliseError(`Key not found: ${keyId}`, 404);
      }
      throw error;
    }
  }

  async getKeyWithContext(
    keyId: string,
    language: string
  ): Promise<KeyWithContext> {
    this.logger.debug({ keyId, language }, "Fetching key with context");

    const targetKey = await this.getKey(keyId, language);

    const allKeys = await this.listKeys({ limit: 1000 });

    const targetIndex = allKeys.findIndex((k) => k.key_id === keyId);
    if (targetIndex === -1) {
      throw new LokaliseError(`Key not found in context: ${keyId}`, 404);
    }

    const before = allKeys.slice(Math.max(0, targetIndex - 2), targetIndex);
    const after = allKeys.slice(
      targetIndex + 1,
      Math.min(allKeys.length, targetIndex + 3)
    );

    return {
      target: targetKey,
      before,
      after,
    };
  }

  async getKeyWithAllTranslations(keyId: string): Promise<LokaliseKey> {
    const now = Date.now();

    const cached = this.keyCache.get(keyId);
    if (cached && now - cached.at < LokaliseClient.KEY_TTL_MS) {
      this.logger.debug({ keyId }, "Fetching key with all translations (cached)");
      return cached.key;
    }

    const existing = this.keyInFlight.get(keyId);
    if (existing) {
      this.logger.debug({ keyId }, "Fetching key with all translations (awaiting in-flight)");
      return existing;
    }

    this.logger.debug({ keyId }, "Fetching key with all translations");

    const promise = (async () => {
      try {
        const path = `/projects/${this.projectId}/keys/${keyId}`;
        const params = { include_translations: 1 };
        const response = await this.http.get<LokaliseKeyResponse>(path, params);
        this.keyCache.set(keyId, { at: Date.now(), key: response.key });
        return response.key;
      } catch (error) {
        if (error instanceof LokaliseError && error.statusCode === 404) {
          throw new LokaliseError(`Key not found: ${keyId}`, 404);
        }
        throw error;
      } finally {
        this.keyInFlight.delete(keyId);
      }
    })();

    this.keyInFlight.set(keyId, promise);
    return promise;
  }

  async getGlossary(language?: string): Promise<Glossary> {
    const cacheKey = language ? `glossary:${language}` : "glossary:all";

    if (this.glossaryCache.has(cacheKey)) {
      this.logger.debug({ language }, "Returning cached glossary");
      return this.glossaryCache.get(cacheKey)!;
    }

    this.logger.debug({ language }, "Fetching glossary");

    try {
      const path = `/projects/${this.projectId}/glossary_terms`;
      const params: Record<string, unknown> = { limit: 5000 };

      if (language) {
        params.filter_lang = language;
      }

      const response = await this.http.get<LokaliseGlossaryResponse>(
        path,
        params
      );

      const glossary: Glossary = {
        terms: response.data,
        terms_count: response.data.length,
      };

      this.glossaryCache.set(cacheKey, glossary);
      return glossary;
    } catch (error) {
      throw new LokaliseError(
        `Failed to fetch glossary: ${error instanceof Error ? error.message : String(error)}`,
        500
      );
    }
  }

  async listKeys(filters?: ListKeysFilters): Promise<LokaliseKey[]> {
    const cacheKey = JSON.stringify(filters ?? {});
    const now = Date.now();

    // 1. Hot cache hit
    if (
      this.listKeysCache &&
      this.listKeysCache.cacheKey === cacheKey &&
      now - this.listKeysCache.at < LokaliseClient.LIST_KEYS_TTL_MS
    ) {
      this.logger.debug({ filters }, "Listing keys (cached)");
      return this.listKeysCache.keys;
    }

    // 2. In-flight dedupe — a concurrent fan-out should share one request
    if (
      this.listKeysInFlight &&
      this.listKeysInFlight.cacheKey === cacheKey
    ) {
      this.logger.debug({ filters }, "Listing keys (awaiting in-flight)");
      return this.listKeysInFlight.promise;
    }

    this.logger.debug({ filters }, "Listing keys");

    const promise = (async () => {
      try {
        const path = `/projects/${this.projectId}/keys`;
        const params: Record<string, unknown> = {
          include_translations: 1,
          limit: filters?.limit || 100,
          offset: filters?.offset || 0,
        };

        if (filters?.tag) params.filter_tags = filters.tag;
        if (filters?.file) params.filter_filenames = filters.file;

        const response = await this.http.get<LokaliseKeysResponse>(
          path,
          params
        );
        this.listKeysCache = { at: Date.now(), keys: response.keys, cacheKey };
        return response.keys;
      } catch (error) {
        throw new LokaliseError(
          `Failed to list keys: ${error instanceof Error ? error.message : String(error)}`,
          500
        );
      } finally {
        if (this.listKeysInFlight?.cacheKey === cacheKey) {
          this.listKeysInFlight = undefined;
        }
      }
    })();

    this.listKeysInFlight = { cacheKey, promise };
    return promise;
  }

  async updateKeyTranslation(
    translationId: string,
    translation: string,
    _reviewed: boolean
  ): Promise<void> {
    this.logger.debug({ translationId }, "Updating translation");

    try {
      const path = `/projects/${this.projectId}/translations/${translationId}`;
      // AI-generated translations are always pushed as unverified so a
      // human translator reviews them before they count as approved.
      // `is_reviewed` is forced false, `is_unverified` forced true,
      // regardless of whether Claude flagged the string.
      const body = {
        translation,
        is_reviewed: false,
        is_unverified: true,
      };

      await this.http.put<void>(path, body);
      this.logger.debug({ translationId }, "Translation updated");

      this.glossaryCache.clear();
    } catch (error) {
      throw new LokaliseError(
        `Failed to update translation: ${error instanceof Error ? error.message : String(error)}`,
        500
      );
    }
  }

  clearGlossaryCache(): void {
    this.logger.debug("Clearing glossary cache");
    this.glossaryCache.clear();
  }

  getProjectId(): string {
    return this.projectId;
  }

  /**
   * Ensure `tag` is present on the given key. Lokalise tags live on keys,
   * not individual translations. This is a no-op if the tag is already
   * present (so it's safe to call redundantly from each fan-out branch).
   */
  async ensureKeyTag(
    keyId: string | number,
    tag: string,
    existingTags: string[]
  ): Promise<void> {
    if (existingTags.includes(tag)) return;

    const merged = Array.from(new Set([...existingTags, tag]));
    const path = `/projects/${this.projectId}/keys/${keyId}`;

    this.logger.debug({ keyId, tag }, "Adding tag to key");

    try {
      await this.http.put<void>(path, { tags: merged });
      // Invalidate cached copy so subsequent fetches see the new tag.
      this.keyCache.delete(String(keyId));
    } catch (error) {
      this.logger.warn(
        {
          keyId,
          tag,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to add tag to key"
      );
    }
  }

  /**
   * Fetch the project's base language ISO (e.g. "en-US"). Cached in-memory
   * after the first call.
   */
  async getBaseLanguageIso(): Promise<string> {
    if (this.baseLanguageIso) return this.baseLanguageIso;

    const path = `/projects/${this.projectId}`;
    const response = await this.http.get<{ base_language_iso?: string }>(path);

    if (!response.base_language_iso) {
      throw new LokaliseError("Project has no base_language_iso", 500);
    }

    this.baseLanguageIso = response.base_language_iso;
    this.logger.debug(
      { baseLanguageIso: this.baseLanguageIso },
      "Loaded project base language"
    );
    return this.baseLanguageIso;
  }

  /**
   * Fetch all language ISO codes configured in the project.
   */
  async listProjectLanguages(): Promise<string[]> {
    const path = `/projects/${this.projectId}/languages`;
    const response = await this.http.get<{
      languages: Array<{ lang_iso: string }>;
    }>(path);
    return response.languages.map((l) => l.lang_iso);
  }
}

let _lokaliseClient: LokaliseClient | undefined;

function getLokaliseClientInstance(): LokaliseClient {
  if (!_lokaliseClient) {
    _lokaliseClient = new LokaliseClient();
  }
  return _lokaliseClient;
}

export { getLokaliseClientInstance as lokaliseClient };
