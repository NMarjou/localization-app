export interface Translation {
  translation_id: number;
  key_id?: number;
  language_iso: string;
  translation: string;
  is_reviewed: boolean;
  is_fuzzy: boolean;
  reviewed_by?: string;
  modified_at?: string;
}

export interface LokaliseKey {
  key_id: string;
  key_name: string;
  description?: string;
  character_limit?: number;
  platforms: string[];
  tags: string[];
  translations: Translation[];
  created_at: string;
  updated_at: string;
}

export interface KeyWithContext {
  target: LokaliseKey;
  before: LokaliseKey[];
  after: LokaliseKey[];
}

export interface GlossaryTerm {
  term_id: string;
  term: string;
  description?: string;
  translations: Record<string, string>;
}

export interface Glossary {
  terms: GlossaryTerm[];
  terms_count: number;
}

export interface ListKeysFilters {
  tag?: string;
  file?: string;
  limit?: number;
  offset?: number;
}

export interface LokaliseApiResponse<T> {
  data: T;
  pagination?: {
    total_count: number;
    page_count: number;
    limit: number;
    offset: number;
  };
}

// Actual Lokalise API response shapes
export interface LokaliseKeysResponse {
  project_id: string;
  keys: LokaliseKey[];
}

export interface LokaliseKeyResponse {
  project_id: string;
  key: LokaliseKey;
}

export interface LokaliseGlossaryResponse {
  project_id: string;
  data: GlossaryTerm[];
}
