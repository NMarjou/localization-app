import { describe, it, expect } from "vitest";
import { ClaudeMessagesClient } from "../../../src/clients/claude-messages.js";
import { ClaudeBatchClient } from "../../../src/clients/claude-batch.js";
import { ClaudeClient } from "../../../src/clients/claude.js";
import { ValidationError } from "../../../src/utils/errors.js";
import type { PromptMessages } from "../../../src/types/prompt.js";

describe("Claude Clients", () => {
  describe("ClaudeMessagesClient", () => {
    it("can be instantiated", () => {
      const client = new ClaudeMessagesClient();
      expect(client).toBeDefined();
    });
  });

  describe("ClaudeBatchClient", () => {
    it("can be instantiated", () => {
      const client = new ClaudeBatchClient();
      expect(client).toBeDefined();
    });
  });

  describe("ClaudeClient", () => {
    let client: ClaudeClient;

    beforeEach(() => {
      client = new ClaudeClient();
    });

    it("can be instantiated", () => {
      expect(client).toBeDefined();
    });

    it("validates prompts with missing system message", () => {
      const invalidPrompts: PromptMessages = {
        system: [],
        messages: [{ role: "user", content: "test" }],
      };

      expect(() => {
        (client as any).validatePrompts(invalidPrompts);
      }).toThrow(ValidationError);
    });

    it("validates prompts with missing user message", () => {
      const invalidPrompts: PromptMessages = {
        system: [{ type: "text", text: "test" }],
        messages: [],
      };

      expect(() => {
        (client as any).validatePrompts(invalidPrompts);
      }).toThrow(ValidationError);
    });

    it("estimates tokens from prompts", () => {
      const prompts: PromptMessages = {
        system: [{ type: "text", text: "word word word" }],
        messages: [{ role: "user", content: "test test test" }],
      };

      const tokens = (client as any).estimateTokens(prompts);
      expect(tokens).toBeGreaterThan(0);
      expect(typeof tokens).toBe("number");
    });

    it("generates unique job IDs", () => {
      const id1 = (client as any).generateJobId();
      const id2 = (client as any).generateJobId();

      expect(id1).toMatch(/^job_/);
      expect(id2).toMatch(/^job_/);
      expect(id1).not.toBe(id2);
    });

    it("validates valid prompts", () => {
      const validPrompts: PromptMessages = {
        system: [{ type: "text", text: "test" }],
        messages: [{ role: "user", content: "test" }],
      };

      expect(() => {
        (client as any).validatePrompts(validPrompts);
      }).not.toThrow();
    });
  });
});
