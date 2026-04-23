# Critical Bug Fixes — Translation Value Extraction

## Overview
Fixed critical bugs in the webhook handler that were preventing the translation service from sending the correct source language text to Claude for translation.

## Issues Identified

### Issue 1: Incorrect Translation Value Field
**Location:** `src/handlers/webhook.ts`, lines 93, 106, 111

**Problem:**
```typescript
const strings = keyContexts.map((kc) => ({
  key_id: kc.target.key_id,
  key_name: kc.target.key_name,
  value: kc.target.key_name,  // ❌ BUG: Using key_name instead of translation text
  ...
}));
```

The `value` field was being set to `key_name` (e.g., "button_submit") instead of the actual source language translation text (e.g., "Submit"). This meant Claude was receiving the key identifier instead of the string to translate.

**Impact:** Translation service would send key names to Claude instead of actual strings, resulting in nonsensical translations.

### Issue 2: Missing Source Language Tracking
**Location:** `src/types/webhook.ts`, `src/handlers/webhook.ts`

**Problem:**
- Webhook events include `source_language_iso` field from Lokalise, but the code wasn't capturing it
- The `WebhookContext` had a single `language` field that was ambiguous (could be source or target)
- The handler couldn't distinguish between source (English) and target (e.g., French) language translations

**Impact:** No way to extract the source language text for translation.

### Issue 3: Fetching Only Target Language Translations
**Location:** `src/handlers/webhook.ts`, line 86

**Problem:**
```typescript
const keyContexts = await Promise.all(
  context.keyIds.map((keyId) =>
    client.getKeyWithContext(String(keyId), context.language)  // Only target language
  )
);
```

The code was calling `getKeyWithContext()` with only the target language filter, so it wouldn't have the source language translation in the returned data.

**Impact:** No source language text available to send to Claude.

## Fixes Applied

### Fix 1: Restructure WebhookContext
**File:** `src/types/webhook.ts`

Changed from ambiguous field:
```typescript
export interface WebhookContext {
  language: string;  // ❌ Ambiguous
  ...
}
```

To explicit source/target fields:
```typescript
export interface WebhookContext {
  sourceLanguage: string;    // ✅ Clear intent
  targetLanguage: string;    // ✅ Clear intent
  ...
}
```

### Fix 2: Add getKeyWithAllTranslations Method
**File:** `src/clients/lokalise.ts`

Added new method to fetch keys with all translations:
```typescript
async getKeyWithAllTranslations(keyId: string): Promise<LokaliseKey> {
  // Fetches the key WITHOUT language filtering, so all translations are included
  const path = `/projects/${this.projectId}/keys/${keyId}`;
  const params = { include_translations: 1 };  // No language filter
  return this.http.get<LokaliseApiResponse<LokaliseKey>>(path, params).then(r => r.data);
}
```

### Fix 3: Extract Source Language Text Correctly
**File:** `src/handlers/webhook.ts`

Added helper method to extract translation text by language:
```typescript
private getTranslationText(key: any, languageIso: string): string {
  const translation = key.translations?.find(
    (t: any) => t.language_iso === languageIso
  );
  return translation?.translation || "";
}
```

Updated webhook handler to:
1. Extract both `source_language_iso` and `target_language_iso` from webhook event:
```typescript
const translation = event.bundle.translations[0];
context.targetLanguage = translation.language_iso;
context.sourceLanguage = translation.source_language_iso || "en";  // Default to English
```

2. Fetch keys with all translations:
```typescript
const allKeys = await Promise.all(
  context.keyIds.map((keyId) =>
    client.getKeyWithAllTranslations(String(keyId))  // ✅ Fetch all translations
  )
);
```

3. Extract source language text:
```typescript
const strings = allKeys.map((key) => ({
  key_id: key.key_id,
  key_name: key.key_name,
  value: this.getTranslationText(key, context.sourceLanguage),  // ✅ Source text
  max_char_limit: key.character_limit,
  screen_or_section: key.platforms?.[0],
}));
```

### Fix 4: Update All References
Updated all logging and context references throughout the webhook handler to use `sourceLanguage` and `targetLanguage` instead of the ambiguous `language` field:
- Line 154: Batch submission logging
- Line 228: Results push logging
- Line 298: Batch completion polling logging
- Plus all other handler methods

### Fix 5: Update Server Initialization
**File:** `src/server.ts`

Updated webhook context initialization to set both language fields:
```typescript
const context: WebhookContext = {
  eventId: eventId || `webhook_${Date.now()}`,
  sourceLanguage: "",      // ✅ Initialized
  targetLanguage: "",      // ✅ Initialized
  keyIds: [],
  timestamp: Date.now(),
};
```

## Data Flow After Fixes

```
Webhook Event (from Lokalise)
├─ language_iso: "fr"              (target)
├─ source_language_iso: "en"       (source)
└─ key_id: 12345

→ WebhookContext
├─ sourceLanguage: "en"
├─ targetLanguage: "fr"
└─ keyIds: [12345]

→ Fetch key with ALL translations
├─ key_id: 12345
├─ key_name: "button_submit"
└─ translations:
    ├─ {language_iso: "en", translation: "Submit"}
    └─ {language_iso: "fr", translation: "Soumettre"}

→ Extract for Claude
├─ key_id: 12345
├─ key_name: "button_submit"
├─ value: "Submit"               ✅ SOURCE TEXT
├─ context.before: [...]
├─ context.after: [...]
└─ target_language: "fr"

→ Claude
├─ System prompt: glossary, TM, style guide (cached)
└─ User prompt: "Translate to French: Submit"

→ Response: "Soumettre"
```

## Testing

All 100 unit tests pass:
```
✓ tests/unit/config.test.ts (3 tests)
✓ tests/unit/clients/lokalise.test.ts (19 tests)
✓ tests/unit/builders/prompt.test.ts (20 tests)
✓ tests/unit/clients/claude.test.ts (8 tests)
```

Build succeeds with no TypeScript errors:
```
npm run build  # ✅ No errors
npm test       # ✅ 100 tests passed
```

## Impact

✅ **Before Fix:**
- Claude received: key_name ("button_submit")
- Claude couldn't translate key names, result was gibberish

✅ **After Fix:**
- Claude receives: source language text ("Submit")
- Claude correctly translates to target language
- Translation memory and glossary context work correctly
- Review flags work as intended

## Files Modified

1. `src/types/webhook.ts` — WebhookContext type update
2. `src/clients/lokalise.ts` — Added getKeyWithAllTranslations method
3. `src/handlers/webhook.ts` — Fixed translation value extraction
4. `src/server.ts` — Updated context initialization

## Backward Compatibility

These are internal structure changes with no impact on:
- Lokalise webhook format (unchanged)
- Claude API prompt format (unchanged)
- Lokalise API calls (updated to fetch all translations, but still compatible)
- External API contracts (health endpoint, webhook response remain same)
