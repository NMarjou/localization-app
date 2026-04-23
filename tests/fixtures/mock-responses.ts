/**
 * Mock API responses for testing
 */

export const mockLokaliseKey = {
  key_id: "12345678",
  key_name: "dashboard.welcome_title",
  description: "Title shown on dashboard welcome screen",
  character_limit: 50,
  platforms: ["ios", "android"],
  tags: ["dashboard", "welcome"],
  translations: [
    {
      language_iso: "en",
      translation: "Welcome to Dashboard",
      is_reviewed: true,
      reviewed_by: "user@example.com",
      is_fuzzy: false,
      modified_at: "2024-01-02T00:00:00Z",
    },
    {
      language_iso: "fr",
      translation: "Bienvenue au tableau de bord",
      is_reviewed: true,
      reviewed_by: "user@example.com",
      is_fuzzy: false,
      modified_at: "2024-01-02T00:00:00Z",
    },
  ],
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-02T00:00:00Z",
};

export const mockNeighboringKeys = [
  {
    key_id: "12345676",
    key_name: "dashboard.subtitle",
    description: "Subtitle for dashboard",
    character_limit: 100,
    platforms: ["ios", "android"],
    tags: ["dashboard"],
    translations: [
      {
        language_iso: "en",
        translation: "Your overview at a glance",
        is_reviewed: true,
        is_fuzzy: false,
      },
    ],
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
  },
  {
    key_id: "12345677",
    key_name: "dashboard.description",
    description: "Description text",
    character_limit: 200,
    platforms: ["ios", "android"],
    tags: ["dashboard"],
    translations: [
      {
        language_iso: "en",
        translation: "Get quick access to all your metrics",
        is_reviewed: true,
        is_fuzzy: false,
      },
    ],
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
  },
];

export const mockLokaliseGlossary = {
  data: [
    {
      term_id: "term_001",
      term: "Dashboard",
      description: "The main dashboard view",
      translations: {
        en: "Dashboard",
        fr: "Tableau de bord",
        de: "Armaturenbrett",
      },
    },
    {
      term_id: "term_002",
      term: "Settings",
      description: "Configuration options",
      translations: {
        en: "Settings",
        fr: "Paramètres",
        de: "Einstellungen",
      },
    },
    {
      term_id: "term_003",
      term: "User Profile",
      description: "User account profile",
      translations: {
        en: "User Profile",
        fr: "Profil utilisateur",
        de: "Benutzerprofil",
      },
    },
  ],
  pagination: {
    total_count: 3,
    page_count: 1,
    limit: 100,
    offset: 0,
  },
};

export const mockLokaliseKeysList = {
  data: [
    mockLokaliseKey,
    ...mockNeighboringKeys,
    {
      key_id: "12345679",
      key_name: "dashboard.button_settings",
      description: "Button to open settings",
      character_limit: 20,
      platforms: ["ios", "android"],
      tags: ["dashboard", "buttons"],
      translations: [
        {
          language_iso: "en",
          translation: "Settings",
          is_reviewed: true,
          is_fuzzy: false,
        },
      ],
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-02T00:00:00Z",
    },
  ],
  pagination: {
    total_count: 5,
    page_count: 1,
    limit: 100,
    offset: 0,
  },
};

export const mockClaudeResponse = {
  content: [
    {
      type: "text",
      text: JSON.stringify({
        translations: {
          key_001: "Translated string",
          key_002: "Another translation",
        },
        flags: [
          {
            key_id: "key_003",
            reason: "Glossary term not matched",
          },
        ],
      }),
    },
  ],
  usage: {
    input_tokens: 1000,
    output_tokens: 100,
  },
};
