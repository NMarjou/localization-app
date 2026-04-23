import { describe, it, expect, beforeEach, vi } from "vitest";
import { LokaliseClient } from "../../../src/clients/lokalise.js";
import { LokaliseError } from "../../../src/utils/errors.js";
import type { Env } from "../../../src/config/env.js";
import {
  mockLokaliseKey,
  mockNeighboringKeys,
  mockLokaliseGlossary,
  mockLokaliseKeysList,
} from "../../fixtures/mock-responses.js";

const mockEnv: Env = {
  ANTHROPIC_API_KEY: "test-anthropic-key",
  LOKALISE_API_KEY: "test-lokalise-key",
  LOKALISE_PROJECT_ID: "test-project-id",
  WEBHOOK_SECRET: "test-webhook-secret",
  PORT: 3000,
  NODE_ENV: "test",
};

vi.mock("../../../src/config/env.js", () => ({
  loadEnv: vi.fn(() => mockEnv),
  getEnv: vi.fn(() => mockEnv),
}));

vi.mock("../../../src/utils/logger.js", () => ({
  initLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  })),
  getLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    })),
  })),
  createChild: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock("../../../src/clients/http.js", () => {
  const MockHttpClient = class {
    async get(path: string) {
      if (path.includes("/keys/12345678")) {
        return { data: mockLokaliseKey };
      }
      if (path.includes("/keys") && !path.includes("/keys/")) {
        return mockLokaliseKeysList;
      }
      if (path.includes("/glossary_terms")) {
        return mockLokaliseGlossary;
      }
      throw new LokaliseError("Not found", 404);
    }

    async put() {
      return undefined;
    }
  };

  return { HttpClient: MockHttpClient };
});

describe("LokaliseClient", () => {
  let client: LokaliseClient;

  beforeEach(() => {
    client = new LokaliseClient();
  });

  describe("getKey", () => {
    it("fetches a key by ID", async () => {
      const key = await client.getKey("12345678");

      expect(key.key_id).toBe("12345678");
      expect(key.key_name).toBe("dashboard.welcome_title");
      expect(key.translations.length).toBeGreaterThan(0);
    });

    it("includes translations in response", async () => {
      const key = await client.getKey("12345678", "en");

      const enTranslation = key.translations.find(
        (t) => t.language_iso === "en"
      );
      expect(enTranslation).toBeDefined();
      expect(enTranslation?.translation).toBe("Welcome to Dashboard");
      expect(enTranslation?.is_reviewed).toBe(true);
    });

    it("throws LokaliseError on 404", async () => {
      await expect(client.getKey("nonexistent")).rejects.toThrow(
        LokaliseError
      );
    });
  });

  describe("getKeyWithContext", () => {
    it("returns key with surrounding context", async () => {
      const context = await client.getKeyWithContext("12345678", "en");

      expect(context.target.key_id).toBe("12345678");
      expect(context.before).toBeDefined();
      expect(context.after).toBeDefined();
      expect(Array.isArray(context.before)).toBe(true);
      expect(Array.isArray(context.after)).toBe(true);
    });

    it("includes target key in the response", async () => {
      const context = await client.getKeyWithContext("12345678", "en");

      expect(context.target.key_name).toBe("dashboard.welcome_title");
    });

    it("includes neighboring keys", async () => {
      const context = await client.getKeyWithContext("12345678", "en");

      const allKeyIds = [
        ...context.before.map((k) => k.key_id),
        context.target.key_id,
        ...context.after.map((k) => k.key_id),
      ];

      expect(allKeyIds.length).toBeGreaterThan(1);
      expect(allKeyIds).toContain("12345678");
    });
  });

  describe("getGlossary", () => {
    it("fetches glossary terms", async () => {
      const glossary = await client.getGlossary();

      expect(glossary.terms).toBeDefined();
      expect(Array.isArray(glossary.terms)).toBe(true);
      expect(glossary.terms.length).toBeGreaterThan(0);
    });

    it("includes term translations", async () => {
      const glossary = await client.getGlossary();

      const dashboardTerm = glossary.terms.find(
        (t) => t.term === "Dashboard"
      );
      expect(dashboardTerm).toBeDefined();
      expect(dashboardTerm?.translations).toBeDefined();
      expect(dashboardTerm?.translations.en).toBe("Dashboard");
      expect(dashboardTerm?.translations.fr).toBe("Tableau de bord");
    });

    it("caches glossary on subsequent calls", async () => {
      const glossary1 = await client.getGlossary();
      const glossary2 = await client.getGlossary();

      expect(glossary1).toBe(glossary2);
    });

    it("supports language-specific filtering", async () => {
      const glossary = await client.getGlossary("fr");

      expect(glossary).toBeDefined();
      expect(glossary.terms.length).toBeGreaterThan(0);
    });

    it("clears cache on clearGlossaryCache", async () => {
      const glossary1 = await client.getGlossary();
      client.clearGlossaryCache();
      const glossary2 = await client.getGlossary();

      expect(glossary1).not.toBe(glossary2);
    });
  });

  describe("listKeys", () => {
    it("lists all keys", async () => {
      const keys = await client.listKeys();

      expect(Array.isArray(keys)).toBe(true);
      expect(keys.length).toBeGreaterThan(0);
    });

    it("includes key metadata", async () => {
      const keys = await client.listKeys();

      const firstKey = keys[0];
      expect(firstKey.key_id).toBeDefined();
      expect(firstKey.key_name).toBeDefined();
      expect(firstKey.translations).toBeDefined();
    });

    it("supports tag filtering", async () => {
      const keys = await client.listKeys({ tag: "dashboard" });

      expect(Array.isArray(keys)).toBe(true);
    });

    it("supports file filtering", async () => {
      const keys = await client.listKeys({ file: "Localizable.strings" });

      expect(Array.isArray(keys)).toBe(true);
    });

    it("supports pagination parameters", async () => {
      const keys = await client.listKeys({ limit: 10, offset: 0 });

      expect(Array.isArray(keys)).toBe(true);
    });
  });

  describe("updateKeyTranslation", () => {
    it("updates a translation", async () => {
      await expect(
        client.updateKeyTranslation("trans_001", "Updated text", true)
      ).resolves.not.toThrow();
    });

    it("clears glossary cache after update", async () => {
      await client.getGlossary();
      const cacheBeforeUpdate = await client.getGlossary();

      await client.updateKeyTranslation("trans_001", "Updated text", true);

      const cacheAfterUpdate = await client.getGlossary();
      expect(cacheBeforeUpdate).not.toBe(cacheAfterUpdate);
    });
  });

  describe("getProjectId", () => {
    it("returns the configured project ID", () => {
      const projectId = client.getProjectId();

      expect(projectId).toBeDefined();
      expect(typeof projectId).toBe("string");
      expect(projectId.length).toBeGreaterThan(0);
    });
  });
});
