# CalcCopilot AI Speed Engine

This folder is **NOT part of the website.** It is the tiny free "data engine" that
measures LLM speeds and publishes a `data.json` your live page reads.
Upload the **contents of this folder** to a **separate public GitHub repo** called
`ai-speed-engine`. You can then delete this folder from the `vfs` website folder
(or leave it — it is inert and harmless if it deploys).

Everything below is done in the **GitHub website + provider dashboards** — no
terminal, no local install.

---

## What's here
| File | Purpose |
|------|---------|
| `ping.mjs` | Measures TTFT + tokens/sec for free-tier models, writes `data.json` (Node 20, no dependencies). |
| `.github/workflows/speed.yml` | Runs `ping.mjs` on a schedule (~every 30 min) and commits `data.json`. |
| `data.json` | Seed data (marked `sample`) — the workflow overwrites it with live data. |

---

## Setup (about 15 minutes, one time)

### 1. Create the repo
1. Sign in / sign up at **github.com** (free).
2. Click **New repository** → name it **`ai-speed-engine`** → set **Public** → **Create**.
   *(Public is required so scheduled Actions run for free.)*
3. On the repo page: **Add file → Upload files**. Drag in `ping.mjs`, `data.json`,
   and the `.github` folder (keep the folder structure). **Commit changes.**

### 2. Get free API keys (no credit card)
- **Cerebras** → <https://cloud.cerebras.ai> (fastest of all; open models)
- **Groq** → <https://console.groq.com/keys> (very fast; open models)
- **Google AI Studio** → <https://aistudio.google.com/apikey> (Gemini)
- **OpenRouter** → <https://openrouter.ai/keys> (many free `:free` models)

You can start with **just one** (e.g. Groq) — models without a key are skipped.

### 3. Add the keys as Secrets
Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
Add each one you have, named exactly:
- `CEREBRAS_API_KEY`
- `GROQ_API_KEY`
- `GEMINI_API_KEY`
- `OPENROUTER_API_KEY`

> Keys live **only** here in GitHub. They are never in the website and never public.

### 4. Run it once
Repo → **Actions** tab → enable workflows if prompted → click **AI speed ping** →
**Run workflow**. After ~1 minute it commits a fresh `data.json`.

### 5. Point the website at your data
Your live JSON URL (via free jsDelivr CDN) is:

```
https://cdn.jsdelivr.net/gh/YOUR_GITHUB_USERNAME/ai-speed-engine@main/data.json
```

Open `vfs/other/ai-speed-test/index.html`, find the line:

```js
var DATA_URL = "https://cdn.jsdelivr.net/gh/REPLACE_ME/ai-speed-engine@main/data.json";
```

Replace `REPLACE_ME` with your GitHub username, save, then re-drag the `vfs`
folder to Netlify. Done — the page now shows live data and refreshes itself.

---

## Notes & honest limits
- **Cron is best-effort.** GitHub can delay scheduled runs when busy; an update may
  occasionally land late. That's normal on the free tier.
- **jsDelivr caches ~12 hours by purge**, but `@main` reflects new commits within a
  few minutes for most users; the page also fetches with `no-store`.
- **Free tiers cover open models + Gemini.** To add **ChatGPT + Claude**, add an
  OpenRouter balance (pennies/month) and add their model IDs to `MODELS` in
  `ping.mjs` — that's the planned "later" upgrade.
- **Accuracy:** identical prompt, fixed output length, median of 3 samples, measured
  from one location. It's a solid *directional* benchmark, not your device's exact speed.
