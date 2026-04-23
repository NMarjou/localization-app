# Localisation Service — Hybrid Lokalise + Claude API

## Architecture

Lightweight bridge between Lokalise and the Claude API that manages translation consistency through TM + glossary caching.

```
Lokalise (webhook)
    ↓
Service (webhook listener)
    ├─ Fetch key + context (Lokalise API)
    ├─ Load cached TM + glossary (file-based)
    ├─ Assemble two-layer prompt (system + user)
    └─ Call Claude API
        ├─ Standard messages API (< 10K words, real-time)
        └─ Batch API (≥ 10K words, async 50% discount)
    ├─ Parse JSON response
    ├─ Update TM + glossary on approval
    └─ Push translations back to Lokalise
```

## Key Constraints

- **Always use `cache_control`** on the system prompt (glossary + TM + style guide)
- **Batch strings by screen/feature**, never one at a time
- **Return JSON** keyed by Lokalise key ID with optional `flags` array
- **Include a flags array** for uncertain strings (glossary mismatches, ambiguity)
- **Surrounding context required** in every request (2–4 strings before/after target)
- **Default model**: `claude-haiku-4-5`
- **High-quality override**: `claude-sonnet-4-6` (flag per request)
- **Translation memory**: File-based (`locales/{lang}/tm.json`), git-tracked
- **Glossary**: Extracted from approved translations + manual config
- **Job routing**: Auto-detect payload size; use Batch API for ≥ 10K words

## Stack

- **Runtime**: Node.js 18+
- **SDK**: `@anthropic-ai/sdk` (Batch API + prompt caching)
- **Test**: Vitest
- **Logging**: Pino (structured JSON)
- **Validation**: Zod

## Environment Variables

```
ANTHROPIC_API_KEY          # Claude API key
LOKALISE_API_KEY           # Lokalise v2 API key
LOKALISE_PROJECT_ID        # Lokalise project ID
WEBHOOK_SECRET             # HMAC secret for webhook validation
PORT                       # Server port (default: 3000)
NODE_ENV                   # development | production
```

## Build & Run

```bash
# Install dependencies
npm install

# Type-check
npm run lint

# Build
npm run build

# Dev with watch
npm run dev

# Tests
npm test
npm test:watch
npm test:coverage

# Build TM from Lokalise (run once on setup)
npm run build:tm

# Start production
npm start
```

## Project Structure

```
src/
├── index.ts                 # Entry point
├── config/
│   └── env.ts              # Zod validation for env vars
├── clients/
│   ├── lokalise.ts         # Lokalise API v2 client
│   └── claude.ts           # Claude API client (messages + batch)
├── builders/
│   ├── prompt.ts           # Two-layer prompt assembly
│   └── tm.ts               # TM & glossary builder
├── handlers/
│   ├── webhook.ts          # Webhook listener + HMAC validation
│   └── result.ts           # Result handler (push to Lokalise)
└── utils/
    ├── logger.ts           # Pino structured logging
    ├── errors.ts           # Custom error classes
    └── cache.ts            # Cache invalidation helpers

locales/
├── en/
│   ├── glossary.json       # Brand terms + approved translations
│   └── tm.json             # Translation memory (key-value pairs)
├── fr/
│   ├── glossary.json
│   └── tm.json
└── [other languages]

tests/
├── unit/
├── integration/
└── fixtures/               # Mock API responses
```

## Phases

1. **Phase 1** (current): Project scaffold — dependencies, config, test setup
2. **Phase 2**: Lokalise API client — fetch keys, glossary, list by filter
3. **Phase 2.5**: TM & glossary builder — extract from Lokalise, store in locales/
4. **Phase 3**: Prompt builder — two-layer prompt with cache control
5. **Phase 4**: Claude API client — messages + Batch modes, retry logic
6. **Phase 5**: Webhook listener — validation, event parsing, job routing
7. **Phase 6**: Result handler — JSON parsing, push to Lokalise, set review status

## Cost Reference

All figures based on stated volumes (750 words ≈ 1,000 tokens).

| Volume | Haiku 4.5 + Batch | Sonnet 4.6 + Batch | Sonnet 4.6 Standard |
|--------|-------------------|-------------------|-------------------|
| 620K words (one-off) | ~$2.48 | ~$7.44 | ~$14.88 |
| 950K words (one-off) | ~$3.80 | ~$11.40 | ~$22.80 |
| 60K/mo ongoing | ~$0.48/mo | ~$1.44/mo | ~$1.44/mo |
| 120K/mo ongoing | ~$0.96/mo | ~$2.88/mo | ~$2.88/mo |

**Recommendation**: Start with Haiku 4.5 + Batch API. Validate translation quality on sample set. Add `model: "sonnet"` override for brand-sensitive projects.

## Key References

- [Claude API docs](https://platform.claude.com/docs)
- [Anthropic SDK (Node.js)](https://npmjs.com/package/@anthropic-ai/sdk)
- [Batch API guide](https://platform.claude.com/docs/en/api/message-batches)
- [Prompt caching guide](https://platform.claude.com/docs/en/api/prompt-caching)
- [Lokalise API v2](https://developers.lokalise.com/reference/lokalise-rest-api)
- [Lokalise webhooks](https://developers.lokalise.com/docs/webhooks)
