# How to use the localisation service

This service sits between Lokalise and Claude. When you mark an English string as reviewed, it automatically translates it into every other language in your project. When you review a translation (say, the French version), it saves that pair into your translation memory so future translations stay consistent.

You don't need to start anything manually — the service runs in the background from the moment you log in to your Mac.

---

## The two things that happen automatically

### 1. You review an English string → Claude translates it

1. Open the key in Lokalise.
2. Change the English text if needed.
3. Tick the "Reviewed" checkbox on the English (`en-US`) translation.
4. Within ~10 seconds, all target languages (French, German, Spanish, etc.) are translated and pushed back to Lokalise.
5. The AI translations show up as **unverified** — that means a human should still look at them before they're considered done.
6. Each translated key gets an `AI-translated` tag so you can filter them in Lokalise.

### 2. You review a translation in another language → TM gets updated

1. Open the key in Lokalise.
2. Tick the "Reviewed" checkbox on the French (or German, etc.) translation.
3. The service saves the approved English → French pair into `locales/fr/tm.json`.
4. Future translations of similar strings will reuse this approved wording.

If you review the same pair twice, it's not saved twice — the service detects duplicates.

---

## The dashboard

Open **http://localhost:3000/ui** in your browser. You'll see:

- **Status** — Healthy means everything is working.
- **Uptime** — How long the service has been running.
- **Pending batches** — Usually 0. Bigger jobs use a slower but cheaper API; this counts how many of those are still in progress.
- **Errors (last hour)** — If this is above 0, something failed recently. Scroll down to see what.
- **Schedule** — When the automatic catch-up job runs.
- **Recent events** — A live log of everything the service has done.

The first time you use the dashboard it will ask for your **webhook secret**. You can find this in your `.env` file next to `WEBHOOK_SECRET=`. Paste it and hit Save. It stays in your browser, not on any server.

---

## Catch-up job (runs every 4 hours)

Every 4 hours (00:00, 04:00, 08:00, 12:00, 16:00, 20:00) the service looks through your project for any English-reviewed strings where the other-language versions are older or missing, and translates them.

This is your safety net. If the service was off when you reviewed something, if a webhook got lost, or if anything else went wrong — the catch-up will fix it within 4 hours.

If you want to run it **right now**, click the **Run backfill now** button in the dashboard.

Note: the catch-up only runs while your Mac is awake. If the computer is asleep at 04:00, that run is skipped — the next one (at 08:00) still fires.

---

## When something looks broken

### Nothing's happening when I review a string

1. Check the dashboard at http://localhost:3000/ui. Is the Status "Offline"?
2. If yes, your Mac may have just restarted — give it 30 seconds to auto-restart, then refresh.
3. If still offline, run this in Terminal:

   ```
   launchctl list | grep localization
   ```

   You should see two lines, both ending in `com.nolwenn.localization-service` and `com.nolwenn.localization-ngrok`. If either is missing, re-install:

   ```
   cd ~/Documents/Repos/localization-app
   ./scripts/install-launchd.sh
   ```

### I want to see what the service is doing

Open Terminal and run:

```
cd ~/Documents/Repos/localization-app
tail -f logs/service.out.log
```

Press `Ctrl+C` to stop watching.

### I reviewed something and it still hasn't translated after 5 minutes

1. Go to the dashboard — any errors in the last hour?
2. If the webhook isn't even reaching us, open **http://localhost:4040** (ngrok's own admin page). It shows every request Lokalise sent us.
3. If Lokalise isn't sending anything, check in Lokalise → Apps → Webhooks that the webhook is still enabled and the URL is `https://countable-robotics-climate.ngrok-free.dev/webhook`.

---

## Stopping or restarting the service

**Restart the app only** (e.g. after you edit code):

```
cd ~/Documents/Repos/localization-app
./scripts/install-launchd.sh
```

**Stop everything:**

```
cd ~/Documents/Repos/localization-app
./scripts/uninstall-launchd.sh
```

After stopping, the dashboard at http://localhost:3000/ui won't load and webhooks will be lost. Start again with `./scripts/install-launchd.sh`.

---

## Summary of files

- `locales/<language>/glossary.json` — brand terms and approved translations per language (used as reference when Claude translates)
- `locales/<language>/tm.json` — translation memory per language (grows as you review)
- `logs/service.out.log` — what the service is doing
- `logs/ngrok.out.log` — tunnel status
- `ui.html` — the dashboard HTML (edit if you want to change its look)
- `.env` — your secrets (API keys, webhook secret) — **do not commit this file**
