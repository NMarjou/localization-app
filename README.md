# Lokalise + Claude Translation Service

Bridges Lokalise and the Claude API. Webhooks from Lokalise trigger
context-aware translations (glossary + TM + style guide + per-project
app context) which are pushed back to Lokalise as unverified strings
ready for human review.

Supports multiple Lokalise projects, each with its own webhook URL,
secret, model, language allowlist, style guide, app context, and
TM/glossary set.

---

## Contents

- [Quick start](#quick-start)
- [Daily commands](#daily-commands)
- [How it works](#how-it-works)
- [Per-project configuration](#per-project-configuration)
- [Locales layout](#locales-layout)
- [Webhook setup in Lokalise](#webhook-setup-in-lokalise)
- [Backfill](#backfill)
- [Cost tracking](#cost-tracking)
- [API endpoints](#api-endpoints)
- [Environment variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

---

## Quick start

```bash
# 1. Install
npm install

# 2. Configure env
cp .env.example .env   # then edit
# Required: ANTHROPIC_API_KEY, LOKALISE_API_KEY

# 3. Configure projects
cp projects.example.json projects.json   # then edit

# 4. Seed each project's TM + glossary from the shared baseline
node scripts/seed-project-locales.mjs <projectId>

# 5. Build + run
npm run build
npm start
```

Verify it's up:

```bash
curl http://localhost:3000/health
```

---

## Daily commands

### Server

```bash
npm run dev      # watch mode (tsx)
npm run build    # tsc → dist/
npm start        # run dist/index.js (production)
npm run lint     # type-check only
```

### Tests

```bash
npm test                  # run once
npm run test:watch        # watch
npm run test:coverage     # with coverage
```

### Health & status

```bash
curl http://localhost:3000/health
curl http://localhost:3000/status | jq          # uptime, projects, recent events
open http://localhost:3000/ui                   # dashboard
```

### Cost

```bash
# Plain-text breakdown (recommended for terminals):
curl -s "http://localhost:3000/cost?format=text"

# Scope to one project:
curl -s "http://localhost:3000/cost?projectId=<id>&format=text"

# JSON for scripting:
curl -s "http://localhost:3000/cost" | jq
```

### Manual backfill

```bash
# All projects, all languages (idempotent — only translates missing/stale keys):
curl -X POST http://localhost:3000/trigger/backfill \
  -H "Content-Type: application/json" \
  -H "X-Secret: <any-project-webhookSecret>" \
  -d '{}'

# Scoped: one project, one language:
curl -X POST http://localhost:3000/trigger/backfill \
  -H "Content-Type: application/json" \
  -H "X-Secret: <any-project-webhookSecret>" \
  -d '{"projectId":"<projectId>","languages":["translations.nl"]}'

# Body fields (all optional):
#   projectId  string     — restrict to one project
#   languages  string[]   — restrict to specific target language ISOs
#   keyIds     number[]   — only consider these keys
#   maxItems   number     — cap how many (key, lang) pairs to fire
```

### Locale management

```bash
# Seed a new project from the baseline:
node scripts/seed-project-locales.mjs <projectId>
node scripts/seed-project-locales.mjs <projectId> --force   # overwrite

# Import a master glossary CSV (one row per term, one column per language):
node scripts/import-master-glossary.mjs --project <projectId> \
  --input Glossaries/<your-master>.csv --source en-US

# Import TM from Lokalise TMX exports (TM stays per-language):
# Drop TMX files in TMs/ first, then:
node scripts/import-tm-glossary.mjs --project <projectId>
node scripts/import-tm-glossary.mjs                          # writes into _template
```

---

## How it works

```
Lokalise (webhook)
    ↓
POST /webhook/<projectId>
    ↓
Auth: X-Secret header == projects.json[projectId].webhookSecret
    ↓
Adapt event:
  - source-language edit  → fan out to one event per non-source target lang
  - target-language edit  → emit "translation.approved" (TM update only)
  - other events          → ignored
    ↓
For each fanned-out event (target language):
  - Fetch key + translations + (for single-key requests) 2 keys before/after for context
  - Build two-layer prompt:
       system  = style guide + appContext + glossary + TM + locale rules  (cached 5 min)
       user    = strings + context + UI metadata
  - Route to Claude:
       <  10K tokens → Messages API (sync)
       ≥ 10K tokens → Batch API (async, 50% discount)
  - Parse JSON response (translations + flags)
  - Push to Lokalise:
       all translations marked is_unverified = true
       (a human translator reviews before approving)
    ↓
Cost log: every Claude call appends {projectId, language, model, batch, tokens, $}
          to data/cost-log.jsonl
```

---

## Per-project configuration

`projects.json` is an array of project entries. Schema (fields validated by Zod):

```jsonc
[
  {
    // Required
    "id":             "<lokalise-project-id>",
    "name":           "Human-readable name",
    "webhookSecret":  "...",                // matched against X-Secret header

    // Optional overrides

    "model":          "haiku-4-5" | "sonnet-4-6",  // default: haiku-4-5
    "languages":      ["fr", "translations.nl"],   // allowlist; omit to translate all non-source languages
    "sourceLanguage": "en",                        // skip Lokalise base-language API call

    "styleGuide":     "Brand Voice rules ...",     // overrides default brand-voice section
    "appContext":     "What the app does, who uses it, key domain jargon ...",

    "enabled":        true                         // false to disable without removing
  }
]
```

### `styleGuide` vs `appContext`

- `styleGuide`: **how** to write — voice, tone, register, punctuation, formality.
- `appContext`: **what** the app is — purpose, audience, domain, jargon to preserve.

Both are part of the cached system-prompt prefix, so they're cheap on
repeated calls within the 5-minute cache window.

### Custom-prefix language codes

Lokalise supports custom language codes (e.g. `translations.nl`,
`translations.fr-FR`). The service handles them transparently:

- Folder lookup tries the literal code first
  (`locales/<projectId>/translations.nl/`), then the de-prefixed form
  (`nl-NL`), then the base form (`nl`).
- Locale-specific style rules (French, German, etc.) match by the base
  ISO 639-1 code regardless of prefix.

So you can put files at `locales/<projectId>/nl/` and they'll work for
`translations.nl`, `translations.nl-NL`, etc.

---

## Locales layout

Every translation resource is **scoped to a single project AND a single
language**. The directory tree is the source of truth — there is no
sharing across projects at runtime.

```
locales/
├── _template/                          # Shared baseline. NOT read at runtime.
│   ├── glossary.json                   # project-wide glossary stub
│   ├── en/
│   │   ├── tm.json                     # [] stub
│   │   └── style-guide.md              # placeholder docs
│   ├── fr/ ...
│   └── ...
├── 7001815568e9335a18f1b8.91255066/    # PayAnalytics
│   ├── glossary.json                   # PayAnalytics master glossary (all languages)
│   ├── nl/
│   │   ├── tm.json                     # PayAnalytics ↔ Dutch TM
│   │   └── style-guide.md              # PayAnalytics ↔ Dutch style guide (optional)
│   └── ...
└── 3516248963a1c7c64d3f50.00551455/    # Accelerate
    ├── glossary.json                   # Accelerate master glossary
    └── <lang>/...
```

The `_template/` folder is the seed copied into each project's
namespace via `scripts/seed-project-locales.mjs`. It's never read at
runtime — translations always pull from `locales/<projectId>/...`.

### Per-project, project-wide resources

| File | Purpose | Format |
|------|---------|--------|
| `<projectId>/glossary.json` | Master glossary for the whole project — one entry per term, with translations for every language inline. | `{ "source": "en", "terms": [...] }` |

### Per-project, per-language resources

Each `<projectId>/<lang>/` folder can hold these optional files. Missing
or empty files just contribute nothing to the prompt for that language.

| File | Purpose | Format |
|------|---------|--------|
| `tm.json` | Translation memory: phrase pairs already approved | `[{ "source": "...", "target": "..." }]` |
| `style-guide.md` | Free-form prose for language-specific rules in this project | Markdown text |

### Project-level (cross-language) resources

Configured per project in `projects.json`:

| Field | Purpose |
|-------|---------|
| `styleGuide` | General brand voice / writing rules. Applied to every language. |
| `appContext` | What the app is, who uses it, key domain jargon. |
| `model` | Claude model override (`haiku-4-5` / `sonnet-4-6`). |
| `languages` | Allowlist (omit to translate every project language). |
| `tmContextSize` / `glossaryContextSize` | How many TM/glossary entries fold into the cached system prompt (default 100 each). |

### How everything stacks in the system prompt

When Claude is asked to translate strings into language `<L>` for project
`<P>`, the system prompt is assembled in this order:

```
1. Brand Voice & Style Guide          ← projects.json[P].styleGuide  (or default)
2. Application Context                 ← projects.json[P].appContext  (if set)
3. Project Style Guide for <L>         ← locales/P/L/style-guide.md   (if non-empty)
4. Project Glossary (<L>)              ← locales/P/glossary.json      (projected to L, top N)
5. Translation Memory                  ← locales/P/L/tm.json          (top N)
6. Locale-Specific Rules               ← built-in localeRules         (formal pronouns etc.)
7. Output Format + global rules        ← always included
```

Everything above the user prompt is cached (5-min TTL) so subsequent calls
within the window pay 10% on cached input tokens. Resources are loaded
lazily and cached in-memory; restart the server to refresh after editing
files on disk.

### File formats

`<projectId>/glossary.json` (project-wide master):
```json
{
  "source": "en",
  "terms": [
    { "en": "Feedback", "fr": "Feedback", "de": "Feedback", "nl": "Feedback" },
    { "en": "Pay gap", "fr": "Écart salarial", "de": "Lohnlücke", "nl": "Beloningsverschil" }
  ]
}
```
Each entry is one row. Keys are language codes (use base codes like `fr`,
`de`, `nl` — the loader handles `fr-FR`, `translations.fr` etc. via
fallback). Missing language for a given term is fine; it just won't be
included in that language's projected glossary.

The runtime projects this master into a per-language `{source: target}`
map at request time. The `glossaryContextSize` cap (default 100) limits
how many terms hit the system prompt per call.

`<projectId>/<lang>/tm.json` (per-language translation memory):
```json
[
  { "source": "Submit", "target": "Indienen" },
  { "source": "Cancel", "target": "Annuleren" }
]
```

`<projectId>/<lang>/style-guide.md`: free-form Markdown — anything you
want Claude to read when translating into this language for this
project. Voice exceptions, specific term choices, formatting quirks,
audience notes, etc.

### TM is updated automatically

When a target-language string is **edited and approved** in Lokalise,
the resulting `translation.approved` event triggers an append to that
project's `tm.json` for that language. Duplicates are deduped.

### Glossary auto-learn (opt-in per project)

Set `"glossaryAutoLearn": true` on a project in `projects.json` to also
write approved translations into the project-wide `glossary.json`. The
write happens on the same `translation.approved` event as the TM update,
so nothing is added until a human has reviewed Claude's output.

Only "term-like" sources are written — anything longer than the
configured thresholds goes only to TM. Defaults:

| Field | Default | Purpose |
|---|---|---|
| `glossaryAutoLearnMaxChars` | 60 | Skip if source longer than this |
| `glossaryAutoLearnMaxWords` | 8 | Skip if source has more words than this |

Behavior on a write:
- If a row with that source value already exists in the master glossary,
  the row's target-language column is filled in (preserves your manual
  curation, just adds the missing language).
- If no row exists, a new row is created with just source + target.
- If the row already has identical target text, no-op.

The new row picks column keys consistent with what's already in the file
(e.g. if existing rows use base codes `fr`/`de`/`nl`, new rows do too).

---

## Webhook setup in Lokalise

Each project gets **its own webhook URL** pointing at a per-project path
on the server.

In Lokalise → **Project Settings → Webhooks → Add webhook**:

| Field | Value |
|-------|-------|
| URL | `https://<your-domain>/webhook/<projectId>` |
| Secret | The `webhookSecret` for that project |
| Header | leave default — Lokalise sends it as `X-Secret` |
| Events | At minimum: `project.translation.proofread`. Optional: `project.key.added`, `project.translation.unapproved` |
| Active | ✓ |

### URL shapes accepted

| URL | Notes |
|-----|-------|
| `POST /webhook/:projectId` | **Recommended.** Per-project. URL projectId is authoritative. |
| `POST /webhooks/:projectId` | Same; alternate spelling. |
| `POST /webhook` | Legacy. Routes by `project.id` in the body. |
| `POST /webhooks` | Same; alternate spelling. |

If both URL and body carry a project ID and they disagree, the request
is rejected with HTTP 400.

### Event mapping

Lokalise event → internal handling:

| Lokalise event | Action |
|----------------|--------|
| `project.translation.proofread` (source-lang edit) | Re-translate to all target languages (or allowlist). |
| `project.translation.proofread` (target-lang edit) | Treated as approved → append to TM. Never re-translates (preserves human work). |
| `project.translation.unapproved` | Tracked. |
| `project.key.added` | Tracked. |
| `project.key.deleted` | Tracked. |
| Any other | Ignored (returns 400). |

Validation pings (`X-Event: ping`) always return 200.

---

## Backfill

Backfill scans every reviewed source key and translates any target
that is missing or older than the source.

### Manual

```bash
curl -X POST http://localhost:3000/trigger/backfill \
  -H "Content-Type: application/json" \
  -H "X-Secret: <any-project-webhookSecret>" \
  -d '{"projectId":"<id>","languages":["translations.nl"]}'
```

Idempotent — keys already up-to-date are skipped. Returns immediately
with `{runId, status:"started"}`. Watch the logs for progress and the
final `Backfill completed` summary.

### Scheduled (off by default)

A cron-driven version of the same job is scaffolded. **Disabled by
default** to avoid surprise costs. Enable with:

```bash
BACKFILL_ENABLED=true            # opt-in
BACKFILL_CRON="0 */4 * * *"      # default: every 4 hours
```

Set `BACKFILL_ENABLED=false` (or omit) to keep it off and rely on
webhooks + manual backfill.

---

## Cost tracking

Every Claude call (sync or batch) is logged with project, language,
model, batch flag, token counts, and USD cost.

- **Persistent**: appended to `data/cost-log.jsonl` (one JSON object per line).
- **Pricing**: Haiku 4.5 ($1/$5 per Mtok in/out) or Sonnet 4.6 ($3/$15), with cache write/read rates and the 50% Batch discount.

### Endpoint

```bash
# Plain-text view (best for terminals):
curl -s "http://localhost:3000/cost?format=text"

# JSON (with formatted strings alongside raw numbers):
curl -s "http://localhost:3000/cost" | jq
```

Query params:

| Param | Type | Effect |
|-------|------|--------|
| `projectId` | string | Filter to a single project |
| `since` | ms-epoch | Only entries at/after this timestamp |
| `until` | ms-epoch | Only entries at/before this timestamp |
| `format` | `json` (default) \| `text` | Response format |

The aggregated view groups by project, language, and model, sorted by
spend (highest first). The recent list shows the last 50 entries with
ISO timestamps.

---

## API endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | none | Liveness + pending batch count |
| GET | `/status` | none | JSON snapshot: uptime, projects, recent events |
| GET | `/cost` | none | Cost summary (see [Cost tracking](#cost-tracking)) |
| GET | `/ui` | none | Dashboard (recent events, projects, run-backfill button) |
| POST | `/webhook/:projectId` | `X-Secret` header | Lokalise webhook (preferred) |
| POST | `/webhook` | `X-Secret` header | Lokalise webhook (legacy) |
| POST | `/trigger/backfill` | `X-Secret` header | Run backfill manually |

The `X-Secret` header value must match a configured project's
`webhookSecret` (constant-time compared).

---

## Environment variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `ANTHROPIC_API_KEY` | ✓ | — | Claude API key |
| `LOKALISE_API_KEY` | ✓ | — | Lokalise API v2 key |
| `PORT` |   | `3000` | Server port |
| `NODE_ENV` |   | `development` | `development` \| `production` \| `test` |
| `WEBHOOK_HEADER_NAME` |   | — | Custom header name to read the secret from (e.g. `x-lokalise-secret`) |
| `BACKFILL_ENABLED` |   | `false` | Set to `true` to enable the scheduled backfill |
| `BACKFILL_CRON` |   | `0 */4 * * *` | Cron expression for the scheduler when enabled |
| `LOKALISE_PROJECT_ID` |   | — | Legacy single-project fallback (used only if `projects.json` is absent) |
| `WEBHOOK_SECRET` |   | — | Legacy single-project fallback secret |

Per-project settings (model, languages, style guide, app context) live
in `projects.json`, not env vars.

---

## Troubleshooting

### Webhook returns 401

Check the server log for which warning fires:

| Log message | Meaning | Fix |
|-------------|---------|-----|
| `Missing webhook secret header` | Lokalise didn't send `X-Secret` (or `X-Api-Key`) | Set `WEBHOOK_HEADER_NAME` to whatever Lokalise is sending |
| `Unknown project in webhook` | URL projectId not in `projects.json` | Ensure the running server has the latest `projects.json` (restart!) |
| `Invalid webhook secret` | Header value doesn't match the project's `webhookSecret` | Update `projects.json` (or regenerate in Lokalise) |
| `URL projectId does not match payload project.id` | Webhook URL points at the wrong project | Fix the webhook URL in Lokalise |

If `projects.json` is changed at runtime, **restart the server** —
project config is loaded once at startup.

### Webhook returns 404

The route isn't matching. Most likely the new code isn't running:

```bash
pkill -f "node.*dist/index" || true
cd ~/localization-app
npm run build && npm start
```

### Translations not being pushed back

- `Claude API error` in logs → check `ANTHROPIC_API_KEY` and quota.
- `Lokalise API error` → check `LOKALISE_API_KEY` and that the
  translation_id resolution worked.
- `No translation_id found for key` → the target language doesn't
  actually exist on this Lokalise project.

### Pending batches stuck

Check `/health` for `pendingBatches`. Batches expire after 24h; the
poller drops expired batches automatically. Otherwise watch the logs
for `Batch poll failed` warnings.

### Cost analysis kicks off unexpectedly

If you see translations happening without a webhook firing, check the
scheduler. By default it's **disabled** (`BACKFILL_ENABLED=false`).
If you previously enabled it, set the env var back to `false` and
restart.

### File permissions weirdness (macOS)

If you can't `cd` into the repo from a fresh terminal after agent
edits, the files may be owned by a different uid. Reclaim ownership:

```bash
sudo chown -R $(whoami):staff ~/localization-app
sudo chmod -R u+rwX ~/localization-app
```

---

## Architecture notes

- **Single Anthropic SDK client per process** (lazy-init).
- **TM/glossary cached in-memory** per FileLoader instance, invalidated
  on append.
- **Lokalise client also cached** — short-TTL (60s) cache on `listKeys`
  and `getKeyWithAllTranslations` plus in-flight dedupe so a webhook
  fan-out to N target languages doesn't issue N identical Lokalise
  requests.
- **Two-layer prompts**: system prompt (style guide + appContext +
  glossary + TM + locale rules) is cached by Claude with a 5-minute TTL;
  per-request user prompt holds just the strings + context.
- **Always 202 Accepted** to Lokalise webhooks (async processing) —
  prevents Lokalise retry loops on internal errors.

---

## References

- [Claude API docs](https://platform.claude.com/docs)
- [Anthropic SDK (Node.js)](https://www.npmjs.com/package/@anthropic-ai/sdk)
- [Batch API guide](https://platform.claude.com/docs/en/api/message-batches)
- [Prompt caching guide](https://platform.claude.com/docs/en/api/prompt-caching)
- [Lokalise API v2](https://developers.lokalise.com/reference/lokalise-rest-api)
- [Lokalise webhooks](https://developers.lokalise.com/docs/webhooks)
