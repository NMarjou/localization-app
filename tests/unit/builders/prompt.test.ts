import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadEnv } from "../../../src/config/env.js";
import { SystemPromptBuilder } from "../../../src/builders/system-prompt.js";
import { UserPromptBuilder } from "../../../src/builders/user-prompt.js";
import { PromptManager } from "../../../src/builders/prompt-manager.js";
import { ValidationError } from "../../../src/utils/errors.js";
import type {
  SystemPromptConfig,
  TranslationRequest,
} from "../../../src/types/prompt.js";

vi.mock("../../../src/config/env.js", () => ({
  loadEnv: vi.fn(() => ({
    ANTHROPIC_API_KEY: "test-key",
    LOKALISE_API_KEY: "test-key",
    LOKALISE_PROJECT_ID: "test-id",
    WEBHOOK_SECRET: "test-secret",
    PORT: 3000,
    NODE_ENV: "test",
  })),
  getEnv: vi.fn(() => ({
    ANTHROPIC_API_KEY: "test-key",
    LOKALISE_API_KEY: "test-key",
    LOKALISE_PROJECT_ID: "test-id",
    WEBHOOK_SECRET: "test-secret",
    PORT: 3000,
    NODE_ENV: "test",
  })),
}));

vi.mock("../../../src/utils/logger.js", () => ({
  initLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  })),
  getLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
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

describe("Prompt Builders", () => {
  let systemPromptBuilder: SystemPromptBuilder;
  let userPromptBuilder: UserPromptBuilder;
  let promptManager: PromptManager;

  const mockConfig: SystemPromptConfig = {
    styleGuide: "Be professional and friendly.",
    glossary: {
      Dashboard: "Tableau de bord",
      Settings: "Paramètres",
    },
    translationMemory: [
      {
        source: "Welcome to Dashboard",
        target: "Bienvenue au tableau de bord",
      },
      {
        source: "Manage your settings",
        target: "Gérez vos paramètres",
      },
    ],
    localeRules: "Use formal vous in professional contexts.",
  };

  beforeAll(() => {
    loadEnv();
    systemPromptBuilder = new SystemPromptBuilder();
    userPromptBuilder = new UserPromptBuilder();
    promptManager = new PromptManager();
  });

  describe("SystemPromptBuilder", () => {
    it("includes style guide in system prompt", async () => {
      const prompt = await systemPromptBuilder.buildSystemPrompt(
        "fr",
        mockConfig
      );

      expect(prompt).toContain("Brand Voice & Style Guide");
      expect(prompt).toContain("Be professional and friendly");
    });

    it("includes glossary in system prompt", async () => {
      const prompt = await systemPromptBuilder.buildSystemPrompt(
        "fr",
        mockConfig
      );

      expect(prompt).toContain("Project Glossary");
      expect(prompt).toContain("Dashboard");
      expect(prompt).toContain("Tableau de bord");
    });

    it("includes translation memory in system prompt", async () => {
      const prompt = await systemPromptBuilder.buildSystemPrompt(
        "fr",
        mockConfig
      );

      expect(prompt).toContain("Translation Memory");
      expect(prompt).toContain("Welcome to Dashboard");
      expect(prompt).toContain("Bienvenue au tableau de bord");
    });

    it("includes locale-specific rules in system prompt", async () => {
      const prompt = await systemPromptBuilder.buildSystemPrompt(
        "fr",
        mockConfig
      );

      expect(prompt).toContain("Locale-Specific Rules");
      expect(prompt).toContain("Use formal vous");
    });

    it("includes output format instructions", async () => {
      const prompt = await systemPromptBuilder.buildSystemPrompt(
        "fr",
        mockConfig
      );

      expect(prompt).toContain("Output Format");
      expect(prompt).toContain("JSON");
      expect(prompt).toContain("translations");
      expect(prompt).toContain("flags");
    });

    it("handles empty glossary gracefully", async () => {
      const config: SystemPromptConfig = {
        ...mockConfig,
        glossary: {},
      };

      const prompt = await systemPromptBuilder.buildSystemPrompt("fr", config);

      expect(prompt).toContain("No glossary terms defined");
    });

    it("handles empty translation memory gracefully", async () => {
      const config: SystemPromptConfig = {
        ...mockConfig,
        translationMemory: [],
      };

      const prompt = await systemPromptBuilder.buildSystemPrompt("fr", config);

      expect(prompt).toContain("No approved translations available");
    });
  });

  describe("UserPromptBuilder", () => {
    it("formats target language in user prompt", () => {
      const request: TranslationRequest = {
        target_language: "French",
        strings: [
          {
            key_id: "key_1",
            key_name: "test.key",
            value: "Test string",
          },
        ],
      };

      const prompt = userPromptBuilder.buildUserPrompt(request);

      expect(prompt).toContain("Target Language: French");
    });

    it("includes target locale when provided", () => {
      const request: TranslationRequest = {
        target_language: "French",
        target_locale: "fr_FR",
        strings: [
          {
            key_id: "key_1",
            key_name: "test.key",
            value: "Test string",
          },
        ],
      };

      const prompt = userPromptBuilder.buildUserPrompt(request);

      expect(prompt).toContain("(fr_FR)");
    });

    it("formats strings with metadata", () => {
      const request: TranslationRequest = {
        target_language: "French",
        strings: [
          {
            key_id: "key_1",
            key_name: "button.save",
            value: "Save",
            string_type: "button",
            max_char_limit: 20,
            screen_or_section: "settings",
          },
        ],
      };

      const prompt = userPromptBuilder.buildUserPrompt(request);

      expect(prompt).toContain("key_1");
      expect(prompt).toContain("button.save");
      expect(prompt).toContain("type: button");
      expect(prompt).toContain("max: 20 chars");
      expect(prompt).toContain("context: settings");
    });

    it("includes context before and after", () => {
      const request: TranslationRequest = {
        target_language: "French",
        strings: [
          {
            key_id: "key_2",
            key_name: "main.title",
            value: "Main Title",
          },
        ],
        context: {
          before: [
            {
              key_id: "key_1",
              key_name: "header",
              value: "Header",
            },
          ],
          after: [
            {
              key_id: "key_3",
              key_name: "subtitle",
              value: "Subtitle",
            },
          ],
        },
      };

      const prompt = userPromptBuilder.buildUserPrompt(request);

      expect(prompt).toContain("Context (Before)");
      expect(prompt).toContain("Context (After)");
      expect(prompt).toContain("header");
      expect(prompt).toContain("subtitle");
    });

    it("handles multiple strings", () => {
      const request: TranslationRequest = {
        target_language: "French",
        strings: [
          {
            key_id: "key_1",
            key_name: "app.title",
            value: "My App",
          },
          {
            key_id: "key_2",
            key_name: "app.subtitle",
            value: "Welcome",
          },
          {
            key_id: "key_3",
            key_name: "app.button",
            value: "Click me",
          },
        ],
      };

      const prompt = userPromptBuilder.buildUserPrompt(request);

      expect(prompt).toContain("1.");
      expect(prompt).toContain("2.");
      expect(prompt).toContain("3.");
    });
  });

  describe("PromptManager", () => {
    it("builds complete message structure", async () => {
      const request: TranslationRequest = {
        target_language: "French",
        strings: [
          {
            key_id: "key_1",
            key_name: "test",
            value: "Test",
          },
        ],
      };

      const messages = await promptManager.buildMessages(request);

      expect(messages.system).toBeDefined();
      expect(messages.messages).toBeDefined();
      expect(messages.system.length).toBe(1);
      expect(messages.messages.length).toBe(1);
    });

    it("sets cache_control on system prompt when enabled", async () => {
      const request: TranslationRequest = {
        target_language: "French",
        strings: [
          {
            key_id: "key_1",
            key_name: "test",
            value: "Test",
          },
        ],
      };

      const messages = await promptManager.buildMessages(request, true);

      expect(messages.system[0].cache_control).toBeDefined();
      expect(messages.system[0].cache_control?.type).toBe("ephemeral");
    });

    it("omits cache_control when disabled", async () => {
      const request: TranslationRequest = {
        target_language: "French",
        strings: [
          {
            key_id: "key_1",
            key_name: "test",
            value: "Test",
          },
        ],
      };

      const messages = await promptManager.buildMessages(request, false);

      expect(messages.system[0].cache_control).toBeUndefined();
    });

    it("user message has correct role", async () => {
      const request: TranslationRequest = {
        target_language: "French",
        strings: [
          {
            key_id: "key_1",
            key_name: "test",
            value: "Test",
          },
        ],
      };

      const messages = await promptManager.buildMessages(request);

      expect(messages.messages[0].role).toBe("user");
      expect(messages.messages[0].content).toBeDefined();
    });

    it("validates request has target_language", async () => {
      const request = {
        target_language: "",
        strings: [
          {
            key_id: "key_1",
            key_name: "test",
            value: "Test",
          },
        ],
      } as TranslationRequest;

      await expect(promptManager.buildMessages(request)).rejects.toThrow(
        ValidationError
      );
    });

    it("validates request has strings", async () => {
      const request: TranslationRequest = {
        target_language: "French",
        strings: [],
      };

      await expect(promptManager.buildMessages(request)).rejects.toThrow(
        ValidationError
      );
    });

    it("validates each string has key_id", async () => {
      const request = {
        target_language: "French",
        strings: [
          {
            key_id: "",
            key_name: "test",
            value: "Test",
          },
        ],
      } as TranslationRequest;

      await expect(promptManager.buildMessages(request)).rejects.toThrow(
        ValidationError
      );
    });

    it("validates each string has value", async () => {
      const request = {
        target_language: "French",
        strings: [
          {
            key_id: "key_1",
            key_name: "test",
            value: "",
          },
        ],
      } as TranslationRequest;

      await expect(promptManager.buildMessages(request)).rejects.toThrow(
        ValidationError
      );
    });
  });
});
