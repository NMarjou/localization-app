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
