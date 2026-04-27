# Lokalise + Claude Translation Service

Automated translation pipeline that bridges Lokalise and Claude API. Receives translation requests via webhooks, processes them with Claude (with full context: glossary, translation memory, style guide), and pushes results back to Lokalise.

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Set Environment Variables
Create a `.env` file in the project root:
```bash
ANTHROPIC_API_KEY=sk-ant-...          # Your Claude API key
LOKALISE_API_KEY=...                  # Lokalise API v2 key
PORT=3000                             # Server port (optional, default: 3000)
NODE_ENV=development                  # development | production (optional)
```

### 3. Configure Projects
Copy `projects.example.json` to `projects.json` and add one entry per
Lokalise project. Each project gets its own webhook secret, optional
model/language overrides, and its own TM + glossary folder.

```json
[
  {
    "id": "123456",
    "name": "Main App",
    "webhookSecret": "shared-secret-app"
  },
  {
    "id": "789012",
    "name": "Marketing Site",
    "webhookSecret": "shared-secret-marketing",
    "model": "sonnet-4-6",
    "languages": ["fr", "de", "es"]
  }
]
```

Then seed each project's locale folder from the shared baseline:
```bash
node scripts/seed-project-locales.mjs 123456
node scripts/seed-project-locales.mjs 789012
```

This copies `locales/_template/{lang}/*` into `locales/{projectId}/{lang}/*`
so each project starts with the same TM + glossary baseline and can
diverge from there.

### 4. Start the Server
```bash
npm start
```

Server logs output will show initialization:
```
INFO: Starting translation service
    env: development
    port: 3000
INFO: Translation service started
```

### 5. Verify Health
```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "pendingBatches": 0,
  "timestamp": "2026-04-22T13:23:57.150Z"
}
```

## Webhook Configuration (Lokalise)

Each Lokalise project gets its own webhook URL and its own secret. Configure
one webhook per project, pointed at its project-specific path.

### For each project:
- Go to **Project Settings** → **Webhooks** (in Lokalise)
- Create a new webhook:
  - **URL**: `https://your-domain.com/webhook/{projectId}` — replace
    `{projectId}` with the Lokalise project ID for that project
  - **Secret**: The `webhookSecret` for that project from `projects.json`
    (sent verbatim in the `X-Secret` header)
  - **Events**: at minimum `project.translation.proofread` for re-translates
    and `project.key.added` / `project.translation.unapproved` if relevant
  - **Active**: ✓ enabled

### URL shapes accepted
| URL | Use |
|-----|-----|
| `POST /webhook/:projectId` | Recommended. Per-project webhooks. |
| `POST /webhooks/:projectId` | Same; alternate spelling. |
| `POST /webhook` | Legacy. Routes by `project.id` in the body. |
| `POST /webhooks` | Same; alternate spelling. |

When the URL includes a `:projectId`, that ID is authoritative. The secret
is checked against that project's secret, and if the body also carries a
`project.id` it must match the URL or the request is rejected with 400.

### Test Webhook
After saving in Lokalise, hit "Test" — the server should respond with
`202 Accepted` (or `200 OK` for the validation ping).

## How It Works

```
Lokalise (webhook event)
         ↓
   Webhook Server
         ↓
   ├─ Validate HMAC signature
   ├─ Extract keys and language
   ├─ Fetch key + surrounding context
   │
   ├─ Build prompt:
   │  ├─ System: glossary + TM + style guide (cached 5 min)
   │  └─ User: target language + strings + context
   │
   ├─ Route to Claude:
   │  ├─ < 10K tokens → Messages API (real-time)
   │  └─ ≥ 10K tokens → Batch API (async, 50% discount)
   │
   ├─ Handle response:
   │  ├─ No flags → auto-approve (reviewed=true)
   │  └─ With flags → needs review (reviewed=false)
   │
   └─ Push to Lokalise
```

## Development

### Run Tests
```bash
npm test              # Run once
npm run test:watch   # Watch mode
npm run test:coverage # Coverage report
```

### Build
```bash
npm run build        # Compile TypeScript
npm run lint         # Type-check only
```

### Dev Mode with Watch
```bash
npm run dev
```

## API Endpoints

### Health Check
```
GET /health
```
Response: `{status: "ok", pendingBatches: 0, timestamp: "ISO-8601"}`

### Webhook
```
POST /webhook/:projectId   (preferred)
POST /webhook              (legacy — routes by body project.id)

Headers:
  Content-Type: application/json
  X-Secret: <project webhookSecret>
  X-Lokalise-Event-Id: <event-id>

Body: Lokalise webhook payload
```

Response: `202 Accepted` (always, even on errors)

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | ✓ | - | Claude API key |
| `LOKALISE_API_KEY` | ✓ | - | Lokalise API v2 key |
| `LOKALISE_PROJECT_ID` | | - | Legacy single-project fallback (used only if `projects.json` is absent) |
| `WEBHOOK_SECRET` | | - | Legacy single-project fallback secret (used only if `projects.json` is absent) |
| `WEBHOOK_HEADER_NAME` | | - | Custom header name to read the project secret from (e.g. `x-lokalise-secret`) |
| `PORT` | | `3000` | Server port |
| `NODE_ENV` | | `development` | `development` or `production` |

Per-project settings (project ID, webhook secret, model, languages, style
guide) live in `projects.json` — see "Configure Projects" above.

## Translation Memory & Glossary

Each project gets its own TM + glossary set, stored as git-tracked JSON
files under `locales/{projectId}/`:

```
locales/
├── _template/                    # Shared baseline. Seed for new projects.
│   ├── en/
│   │   ├── glossary.json
│   │   └── tm.json
│   └── fr/ ...
├── 123456/                       # Project ID 123456
│   ├── en/
│   │   ├── glossary.json
│   │   └── tm.json
│   └── fr/ ...
└── 789012/                       # Project ID 789012
    └── ...
```

The `_template/` folder is **never read at runtime** — it exists only as
a seed copied into a new project's namespace via:
```bash
node scripts/seed-project-locales.mjs <projectId>
# or, to overwrite existing files:
node scripts/seed-project-locales.mjs <projectId> --force
```

### Importing TM & Glossary from Lokalise exports
Drop TMX files in `TMs/` and CSV glossaries in `Glossaries/`, then run:
```bash
# Write into a project's namespace:
node scripts/import-tm-glossary.mjs --project 123456

# Or write into the shared template (default):
node scripts/import-tm-glossary.mjs
```

## Monitoring

### Logs
- **Development**: Pretty-printed JSON with colors
- **Production**: JSON format for log aggregation

### Pending Batches
Check via health endpoint:
```bash
curl http://localhost:3000/health | jq .pendingBatches
```

Batch polling happens automatically every 30 seconds.

## Troubleshooting

### Server won't start
1. **Missing env vars**: Check `.env` file has all required variables
2. **Port in use**: Change `PORT` env var or kill process on 3000
3. **Logger error**: Ensure `NODE_ENV` is `development` or `production`

### Webhook not received
1. **HMAC validation fails**: Verify `WEBHOOK_SECRET` matches Lokalise
2. **URL not reachable**: Ensure server is public (not localhost) if using Lokalise cloud
3. **Firewall/proxy**: Check inbound POST requests to `/webhook`

### Translations not pushing
1. **Claude API error**: Check `ANTHROPIC_API_KEY` is valid and has quota
2. **Lokalise API error**: Verify `LOKALISE_API_KEY` and `LOKALISE_PROJECT_ID`
3. **Rate limited**: Service retries automatically with exponential backoff

### Batch not completing
- Batches poll every 30 seconds
- Batch API can take minutes to hours (Lokalise queue)
- Check health endpoint for `pendingBatches` count
- Check server logs for poll errors

## Cost Reference

| Volume | Haiku 4.5 + Batch | Sonnet 4.6 + Batch |
|--------|-------------------|-------------------|
| 620K words (one-off) | ~$2.48 | ~$7.44 |
| 950K words (one-off) | ~$3.80 | ~$11.40 |
| 60K/mo ongoing | ~$0.48/mo | ~$1.44/mo |
| 120K/mo ongoing | ~$0.96/mo | ~$2.88/mo |

*Estimates based on 750 words ≈ 1,000 tokens*

## Architecture

### Phase 1: Scaffold
Configuration, logging, error handling, file caching

### Phase 2: Lokalise Client
API wrapper for fetching keys with context, pushing translations

### Phase 3: Prompt Builders
Two-layer prompts (cached system + per-request user) with glossary & TM

### Phase 4: Claude Client
Auto-routes by token count (messages API for <10K, batch for ≥10K)

### Phase 5: Webhook Server
Express server with HMAC validation, event dispatch, result handling

## Security

- **HMAC Validation**: All webhooks validated with constant-time comparison
- **API Keys**: Stored in environment, never in code
- **Error Handling**: Never returns 5xx (prevents Lokalise retry loops)
- **Logging**: Full context logging for debugging without sensitive data

## Support

- [Claude API Docs](https://platform.claude.com/docs)
- [Lokalise API Docs](https://developers.lokalise.com/reference/lokalise-rest-api)
- [Lokalise Webhooks](https://developers.lokalise.com/docs/webhooks)
