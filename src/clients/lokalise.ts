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
  LokaliseApiResponse,
} from "../types/lokalise.js";

export class LokaliseClient {
  private http: HttpClient;
  private projectId: string;
  private logger: ReturnType<typeof getLogger>;
  private glossaryCache: Map<string, Glossary> = new Map();

  constructor() {
    const env = getEnv();
    this.projectId = env.LOKALISE_PROJECT_ID;
    this.logger = getLogger();

    this.http = new HttpClient({
      baseUrl: "https://api.lokalise.com/api2",
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

      const response = await this.http.get<LokaliseApiResponse<LokaliseKey>>(
        path,
        params
      );

      return response.data;
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
    this.logger.debug({ keyId }, "Fetching key with all translations");

    try {
      const path = `/projects/${this.projectId}/keys/${keyId}`;
      const params = {
        include_translations: 1,
      };

      const response = await this.http.get<LokaliseApiResponse<LokaliseKey>>(
        path,
        params
      );

      return response.data;
    } catch (error) {
      if (error instanceof LokaliseError && error.statusCode === 404) {
        throw new LokaliseError(`Key not found: ${keyId}`, 404);
      }
      throw error;
    }
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

      const response = await this.http.get<
        LokaliseApiResponse<GlossaryTerm[]>
      >(path, params);

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
    this.logger.debug({ filters }, "Listing keys");

    try {
      const path = `/projects/${this.projectId}/keys`;
      const params: Record<string, unknown> = {
        include_translations: 1,
        limit: filters?.limit || 100,
        offset: filters?.offset || 0,
      };

      if (filters?.tag) {
        params.filter_tags = filters.tag;
      }

      if (filters?.file) {
        params.filter_filenames = filters.file;
      }

      const response = await this.http.get<LokaliseApiResponse<LokaliseKey[]>>(
        path,
        params
      );

      return response.data;
    } catch (error) {
      throw new LokaliseError(
        `Failed to list keys: ${error instanceof Error ? error.message : String(error)}`,
        500
      );
    }
  }

  async updateKeyTranslation(
    translationId: string,
    translation: string,
    reviewed: boolean
  ): Promise<void> {
    this.logger.debug({ translationId, reviewed }, "Updating translation");

    try {
      const path = `/projects/${this.projectId}/translations/${translationId}`;
      const body = {
        translation,
        is_reviewed: reviewed,
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
}

let _lokaliseClient: LokaliseClient | undefined;

function getLokaliseClientInstance(): LokaliseClient {
  if (!_lokaliseClient) {
    _lokaliseClient = new LokaliseClient();
  }
  return _lokaliseClient;
}

export { getLokaliseClientInstance as lokaliseClient };
