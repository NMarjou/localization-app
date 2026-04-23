# Quick Start Guide

## 1. Setup

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests (should see 100/100 passing)
npm test
```

## 2. Configure Environment

Create `.env` file (template in `.env.example`):
```bash
ANTHROPIC_API_KEY=sk-ant-...          # Your Claude API key
LOKALISE_API_KEY=...                  # Your Lokalise v2 key
LOKALISE_PROJECT_ID=123456            # Your project ID
WEBHOOK_SECRET=your-secret-key-here   # Min 32 characters
PORT=3000
NODE_ENV=development
```

## 3. Start Server

```bash
npm start
```

Should see:
```
INFO: Translation service started
  port: 3000
  env: development
```

## 4. Test Health Endpoint

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "ok",
  "pendingBatches": 0,
  "timestamp": "2026-04-22T16:35:00.000Z"
}
```

## 5. Configure Lokalise Webhook

1. Go to **Project Settings** → **Webhooks**
2. Create new webhook:
   - **Event:** `translation.updated` (and/or `translation.approved`)
   - **URL:** `https://your-domain.com/webhook`
   - **Secret:** Same as `WEBHOOK_SECRET` from step 2
   - **Active:** ✓ checked

3. Click "Test" — you should see `202 Accepted` response

## 6. Test Webhook

Send a test webhook (requires valid HMAC signature):

```bash
# Generate signature
PAYLOAD='{"event":"translation.updated","project_id":"123","bundle":{"translations":[{"key_id":1,"language_iso":"fr","source_language_iso":"en-US"}]}}'
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "your-secret-key" -hex | cut -d' ' -f2)

# Send webhook
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "X-Lokalise-Signature: $SIGNATURE" \
  -H "X-Lokalise-Event-Id: test-123" \
  -d "$PAYLOAD"
```

Response: `{"eventId": "test-123"}` (202 Accepted)

## 7. Monitor Logs

The server logs all webhook events:
```
Extracting translation request
  eventId: test-123
  sourceLanguage: en
  targetLanguage: fr
  keyCount: 1
```

## 8. Available Translation Models

Default: **Claude Haiku 4.5** (fast, economical)
- Cost: ~$0.48/mo for 60K words
- Recommended for routine translations

Override: **Claude Sonnet 4.6** (high quality)
- Cost: ~$1.44/mo for 60K words
- Recommended for brand-sensitive content

## 9. Supported Languages

✅ Ready with TM + glossaries loaded:
- English (en)
- French (fr) — includes 1,029 glossary terms
- German (de)
- Spanish (es)
- Italian (it)
- Portuguese (pt)
- Japanese (ja)
- Dutch (nl)
- Thai (th)
- Indonesian (id)
- Turkish (tr)

TM size: 10,070 entries per language × 11 languages = 110,770 total

## 10. What Happens Behind the Scenes

```
1. Lokalise sends webhook with language and key IDs
   ↓
2. Service fetches key + surrounding context (2 before, 2 after)
   ↓
3. Loads TM + glossary from disk (cached 5 minutes)
   ↓
4. Builds prompt:
   - System: glossary + TM + style guide (cached per session)
   - User: source text + target language
   ↓
5. Routes to Claude:
   - < 10K tokens → Messages API (real-time, ~1 second)
   - ≥ 10K tokens → Batch API (async, 50% cheaper)
   ↓
6. Parses response (translations + flags)
   ↓
7. Pushes to Lokalise:
   - Flagged → marked "needs review"
   - Clean → auto-approved
```

## Troubleshooting

### "WEBHOOK_SECRET is required"
✗ Add `WEBHOOK_SECRET` to `.env` (min 32 chars)

### "Invalid webhook signature"
✗ Verify HMAC secret matches in Lokalise AND `.env`
✗ Webhook payload must be sent as raw JSON body

### "Port 3000 is in use"
✗ Kill existing process: `lsof -ti:3000 | xargs kill -9`
✗ Or set `PORT=3001` in `.env`

### "Translation not appearing in Lokalise"
✗ Check logs for errors (Claude API key, rate limiting, etc.)
✗ Verify key ID exists in Lokalise project
✗ Check Lokalise API key has write permissions

### "Tests failing"
✗ Run `npm run build` first (compile TypeScript)
✗ Verify `.env` is not required for unit tests (they mock APIs)

## Learn More

- **Setup & Configuration:** See `README.md`
- **Implementation Details:** See `IMPLEMENTATION_STATUS.md`
- **Recent Bug Fixes:** See `BUG_FIXES_SUMMARY.md`
- **Architecture:** See `CLAUDE.md`
- **Cost Estimates:** See `IMPLEMENTATION_STATUS.md` section 8

## Success Indicators

You'll know it's working when:
- ✅ `npm start` starts without errors
- ✅ `curl /health` returns 200 with `status: "ok"`
- ✅ Test webhook returns 202 Accepted
- ✅ Server logs show "Processing webhook event"
- ✅ Translations appear in Lokalise within seconds (or in batch queue)
- ✅ `npm test` shows 100/100 passing

---

**Ready to translate!** 🚀
