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
LOKALISE_PROJECT_ID=123456            # Your Lokalise project ID
WEBHOOK_SECRET=your-secret-key        # HMAC secret for webhook validation
PORT=3000                             # Server port (optional, default: 3000)
NODE_ENV=development                  # development | production (optional)
```

### 3. Start the Server
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

### 4. Verify Health
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

### 1. Get Webhook Secret
Use the value you set for `WEBHOOK_SECRET` in your `.env`

### 2. Configure in Lokalise
- Go to **Project Settings** → **Webhooks**
- Create new webhook:
  - **Event**: `translation.updated` (and/or `translation.approved`)
  - **URL**: `https://your-domain.com/webhook`
  - **Secret**: Same as `WEBHOOK_SECRET` env var
  - **Active**: ✓ enabled

### 3. Test Webhook
Lokalise will send a test POST request. Server should respond with `202 Accepted`.

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
POST /webhook
Headers:
  Content-Type: application/json
  X-Lokalise-Signature: <HMAC-SHA256>
  X-Lokalise-Event-Id: <event-id>

Body: Lokalise webhook payload
```

Response: `202 Accepted` (always, even on errors)

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | ✓ | - | Claude API key |
| `LOKALISE_API_KEY` | ✓ | - | Lokalise API v2 key |
| `LOKALISE_PROJECT_ID` | ✓ | - | Lokalise project ID |
| `WEBHOOK_SECRET` | ✓ | - | HMAC validation secret |
| `PORT` | | `3000` | Server port |
| `NODE_ENV` | | `development` | `development` or `production` |

## Translation Memory & Glossary

Translation memory (TM) and glossaries are stored as git-tracked JSON files:

```
locales/
├── en/
│   ├── glossary.json       # Brand terms and approved translations
│   └── tm.json             # Key-value translation pairs
├── fr/
│   ├── glossary.json
│   └── tm.json
└── [other languages]
```

### Building TM from Lokalise
To extract approved translations and build initial TM:
```bash
npm run build:tm
```

This populates `locales/{language}/tm.json` and `glossary.json` from Lokalise.

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
