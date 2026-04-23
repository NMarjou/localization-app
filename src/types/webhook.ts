export type LokaliseWebhookEventType =
  | "project.language_added"
  | "project.language_removed"
  | "translation.updated"
  | "translation.approved"
  | "translation.unapproved"
  | "key.added"
  | "key.removed";

export interface LokaliseWebhookKey {
  key_id: number;
  key_name: string;
  key_platforms: string[];
}

export interface LokaliseWebhookTranslation {
  key_id: number;
  language_iso: string;
  words: number;
  source_language_iso?: string;
}

export interface LokaliseWebhookBundle {
  keys?: LokaliseWebhookKey[];
  translations?: LokaliseWebhookTranslation[];
}

export interface LokaliseWebhookEvent {
  event: LokaliseWebhookEventType;
  project_id: string;
  bundle: LokaliseWebhookBundle;
}

export interface WebhookContext {
  eventId: string;
  sourceLanguage: string;
  targetLanguage: string;
  keyIds: number[];
  /**
   * Map of key_id -> translation_id for the target language,
   * built while fetching keys from Lokalise. Needed because the
   * Lokalise PUT endpoint expects translation_id, not key_id.
   */
  keyIdToTranslationId?: Record<string, string>;
  /**
   * Map of key_id -> tags currently on the key. Used to decide
   * whether the "AI-translated" tag needs to be added after push.
   */
  keyIdToTags?: Record<string, string[]>;
  requestId?: string;
  batchId?: string;
  timestamp: number;
}

export interface PendingBatch {
  batchId: string;
  context: WebhookContext;
  createdAt: number;
  pollCount: number;
}
