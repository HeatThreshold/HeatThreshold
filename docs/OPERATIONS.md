# Operations runbook

Deploy, secrets, and demo-day safety nets for Heat Threshold. One page, scannable.

---

## 1. Deploy to Vercel

### One-time setup

```bash
# In the repo root
npx vercel link            # picks/creates the project, writes .vercel/project.json
cat .vercel/project.json   # copy orgId + projectId from here
```

Set three repo secrets on GitHub:

```bash
gh secret set VERCEL_TOKEN       # from https://vercel.com/account/tokens
gh secret set VERCEL_ORG_ID      # the orgId from .vercel/project.json
gh secret set VERCEL_PROJECT_ID  # the projectId from .vercel/project.json
```

Set Vercel environment variables (Vercel dashboard → Settings → Environment Variables):

| Name | Scope | Required | Notes |
|---|---|---|---|
| `GEMINI_API_KEY` | Production + Preview | ✅ yes | Without this, `POST /api/plan` 500s. McpReplay still works. |
| `GOOGLE_MAPS_PLATFORM_KEY` | Production + Preview | ⚪ optional | Enables live Directions polylines, the Maps embed, and the 3D Tiles floor in XR. Without it, each surface falls back gracefully. |
| `BLOB_READ_WRITE_TOKEN` | Production + Preview | ⚪ optional | Auto-set when a Vercel Blob store is provisioned (Storage → Create Database → Blob → connect to project). **Without it, live `/api/plan` runs don't persist** — only baked-in `mcp-traces/` fixtures are replayable. With it, every run writes to blob and `?replay=<runId>` works for any live run forever. |

### Every-deploy mechanics

`.github/workflows/deploy.yml` runs on every push to `main` and every PR:

```
actions/checkout → setup-node@22 → npm ci → npm i -g vercel
→ vercel pull → vercel build → vercel deploy
```

Push to `main` deploys to production; PR opens a preview. The preview URL on a PR is your first end-to-end smoke test.

### Manual deploy from your machine

If CI is blocked, ship from local:

```bash
npx vercel deploy --prod        # production
npx vercel deploy               # preview
```

Vercel prompts for login the first time.

---

## 2. Pre-stage demo prep

A 10-minute checklist to run **before going on stage**:

1. **Warm a known-good run** so the dashboard has a populated card on first load:
   ```bash
   curl -X POST https://<host>/api/plan \
     -H "Content-Type: application/json" \
     -d '{"location":"SF Ferry Building","activity":"Biking with Coit Tower climb","time":"14:30"}'
   ```
   Capture the `id` from the response — that's your safety-net `runId`.

2. **Verify the safety net** by opening `https://<host>/?replay=<runId>` in incognito. You should see:
   - The McpReplay banner ("McpReplay Active · Replaying McpTape recording …").
   - The same verdict + flag + refuges as the live run.
   - A working "View Span Tree" link.

3. **Verify the trace viewer**: `https://<host>/trace/<runId>` should render the PlatAtlas span tree with parallel Weather + Place bars.

4. **List recorded runs**: `curl https://<host>/api/runs` should return the run you just made. If a previous deploy bundled good recordings via `includeFiles: mcp-traces/**` they show up too.

5. **Browser tabs pre-staged**:
   - Tab 1: `https://<host>/` (fresh dashboard, no params)
   - Tab 2: `https://<host>/?replay=<runId>` (safety net)
   - Tab 3: `https://<host>/trace/<runId>` (span tree)

6. **Clipboard**: `npm run threshold-plan -- --demo zilker-bike` queued for the Antigravity-surface terminal beat.

7. **Phone**: 30-second screen recording of the happy path as last-resort backup if both live and replay fail simultaneously.

---

## 3. McpTape recording management

Recordings live in one of two stores depending on environment:

| Environment | Storage | Persistence |
|---|---|---|
| **Production (Vercel + `BLOB_READ_WRITE_TOKEN`)** | Vercel Blob at `mcp-traces/<runId>.json` | Survives cold starts. Every live run is replayable indefinitely. |
| **Production (Vercel, no blob token)** | Read-only `mcp-traces/` from the deploy bundle | Only baked-in fixtures committed pre-deploy are replayable. Live runs vanish at request-end. |
| **Local dev (`npm run dev`)** | `mcp-traces/<runId>.json` on the repo filesystem | Persisted between dev-server restarts. Commit individual recordings to ship them with future deploys. |

McpTape tries Blob first when the token is present, then falls back to filesystem. McpReplay does the same on read. The two backends are interchangeable — fixtures committed to `mcp-traces/` and live runs written to Blob both surface via the same `/api/replay/:runId` endpoint.

### To ship a baked-in replay with the deploy

```bash
# 1. Run locally against a working GEMINI_API_KEY
npm run dev
curl -X POST localhost:3000/api/plan \
  -H "Content-Type: application/json" \
  -d '{"location":"Zilker Park","activity":"Heavy trail biking","time":"13:00"}'

# 2. The orchestrator's recordRun() side-effect drops the recording here:
ls mcp-traces/*.json

# 3. Commit and push — the next deploy ships it
git add mcp-traces/<runId>.json
git commit -m "chore: bundle stage-safety McpTape recording"
git push
```

After deploy, that runId is reachable at `https://<host>/?replay=<runId>` even with zero live API calls.

### To clean up

Old recordings can be deleted freely — they're not referenced anywhere except their own filename. `.gitignore` excludes the MCP-server JSONL traces (`*-mcp.jsonl`, `*-mcp-server.jsonl`) but tracks the run JSON intentionally.

---

## 4. Security

### Google Maps Platform key

The key is exposed client-side three places:
- Maps JS embed on the dashboard (`@vis.gl/react-google-maps`).
- `gmpKey` URL parameter passed into the XR iframe for 3D Tiles.
- 3D Tiles requests to `tile.googleapis.com` directly from the browser.

This is unavoidable — none of the three SDKs support server-side proxying without rebuilding. The standard mitigation is to lock the key down in the GCP console:

1. **HTTP referrer restrictions**: limit to `https://<host>/*` and `https://*.vercel.app/*` (preview deploys). Without this, a leak in browser history / screenshots / referer headers can be exploited.
2. **API restrictions**: enable only the three APIs we use:
   - Maps JavaScript API
   - Directions API
   - Map Tiles API
3. **Billing cap**: set a per-day budget alert. Hackathon billing can spike from accidental refresh loops.

### Gemini key

`GEMINI_API_KEY` is **server-only**. Never expose it to the browser. The orchestrator and `/api/watch/tick` route both use `getGeminiClient()` from [src/lib/agents/managedAgents.ts](../src/lib/agents/managedAgents.ts), which reads from `process.env.GEMINI_API_KEY` — that's a server-only `process.env`, not a `VITE_` env exposed to Vite's build.

### Medical-advice firewall

The `SUBAGENT_SPECS.synthesis.systemInstruction` carries the firewall rules. To re-verify before a demo:

```bash
grep -RIn "medical\|diagnosis\|symptoms\|treatment\|illness\|doctor\|patient" src/ public/ \
  | grep -v "Speak only\|Hard rules:\|FIREWALL\|never use:\|not medical advice\|never give\|never list\|medical-advice firewall"
```

Should return zero hits. Any hit is a regression that needs a fix before recording.

---

## 5. What breaks first under stress

Failure modes ranked by likelihood, in order, with the visible symptom + mitigation:

| # | Failure | Symptom | Mitigation |
|---|---|---|---|
| 1 | **Gemini API rate limit / timeout** | `/api/plan` 5xx, dashboard shows "Offline mode active" banner | `?replay=<runId>` swap; client also auto-falls back to a matching demoFixtures preset |
| 2 | **Stage wifi drops mid-XR-bootstrap** | xr.html cosmetic crashes (mouseController, troika fetch, 3D Tiles DNS) | The transient-failure shield in [public/xr.html](../public/xr.html) catches the known patterns and emits quiet `[XR] Suppressed …` warnings instead of red errors |
| 3 | **NWS API outage** | Weather sub-agent silent fallback to Open-Meteo, then simulated | Trace line surfaces the actual source (`nws` / `open-meteo` / `simulated`); honesty beat in the demo script |
| 4 | **GMP key referrer-restricted to wrong domain** | Map embed black, 3D Tiles invisible, polylines straight-line | Add the actual deploy URL to the referrer allowlist; verify with `curl` against `tile.googleapis.com/v1/3dtiles/root.json?key=$KEY` from the deploy URL's referer header |
| 5 | **Vercel cold start > 10s** | First `/api/plan` slow, subsequent ones fast | Hit `/api/runs` or `/api/plan?demo=sf-route` a few seconds before the demo to keep the function warm |

---

## 6. Quick-reference commands

```bash
# Typecheck
npm run lint

# Local dev (Vite + Express middleware on :3000)
npm run dev

# Production build
npm run build && npm start

# Hit the agent from terminal (Antigravity CLI stand-in)
npm run threshold-plan -- --demo sf-route
npm run threshold-plan -- --location "Zilker Park" --activity "biking" --time "13:00"

# List all McpTape recordings on the live host
curl https://<host>/api/runs | jq

# Pull one recording's PlanResult
curl https://<host>/api/replay/<runId> | jq .verdict
```
