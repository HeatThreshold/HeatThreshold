# Antigravity skill: `/threshold-plan`

Heat Threshold ships a portable skill script that any Antigravity surface
(CLI, IDE chat, scheduled job) can invoke to drive the production
Managed Agents pipeline from a developer's workflow. This is how the
**Gemini 3.5 Flash · Antigravity CLI** and **Gemini 3.5 Flash · Antigravity IDE**
surfaces in the [README](../README.md#gemini-35-flash-across-every-surface)
are realized.

## What the skill does

`/threshold-plan` posts a `{ location, activity, time }` query to the
running Heat Threshold server's `/api/plan` endpoint, waits for the
Managed Agents fan-out to complete, and prints the verdict + flag + peak
wet-bulb + suggested refuges + the full 9-sub-agent trace inline. Every
run returns a `runId` whose `/trace/<runId>` URL renders the PlatAtlas
span tree.

## Running it directly

```bash
# Live managed-agents run
tsx scripts/threshold-plan.ts \
  --location "Zilker Park, Austin, TX" \
  --activity "Heavy trail biking" \
  --time "13:00"

# Demo preset (no LLM cost — useful for canned stage demos)
tsx scripts/threshold-plan.ts --demo zilker-bike

# Custom host
THRESHOLD_HOST=https://heat-threshold.vercel.app \
  tsx scripts/threshold-plan.ts --demo sf-route
```

Output ends with:

```
├─ runId: 7f4e91…
│  Trace viewer: https://heat-threshold.vercel.app/trace/7f4e91…
│  Replay URL:   https://heat-threshold.vercel.app/?replay=7f4e91…
╰─ done in 4280ms
```

That `Replay URL` is the demo safety net — if a live agent call ever
hangs on stage, paste that URL into the browser and the same card
renders from a McpTape recording.

## Wiring as a custom Antigravity skill

1. In the Antigravity CLI/IDE, register a new custom skill named
   `threshold-plan` that shells out to:

   ```
   tsx ${PROJECT_ROOT}/scripts/threshold-plan.ts $@
   ```

2. The skill takes free-form natural language arguments. The Antigravity
   chat agent (powered by Gemini 3.5 Flash) extracts `--location`,
   `--activity`, `--time` flags from the user message and invokes the
   script.

3. Output is plain text with a structured trace block, so it renders
   cleanly inside the Antigravity chat panel and the IDE inline tool
   result panel.

## Why this counts as a Gemini surface

The Antigravity tool itself is powered by Gemini 3.5 Flash. When the
user types `/threshold-plan bike to Zilker at 1pm` in the Antigravity
chat:

1. Gemini 3.5 Flash inside Antigravity parses the intent and extracts
   args (`--location "Zilker Park, Austin, TX"`, `--activity "biking"`,
   `--time "13:00"`).
2. The skill shells out to this script.
3. The script POSTs to `/api/plan`, which dispatches the
   Managed Agents fan-out — three more Gemini 3.5 Flash invocations
   (`threshold-location-subagent`, `threshold-place-subagent`,
   `threshold-synthesis-subagent`).

So a single chat message routes through Gemini 3.5 Flash **four times**
across two surfaces (Antigravity chat parser + three managed sub-agents
on the server), with the response rendered both in the Antigravity panel
and as a live URL the user can paste anywhere else.

## Ship status (for the demo)

- ✅ `scripts/threshold-plan.ts` portable runner
- ✅ Works against the local dev server (`THRESHOLD_HOST=http://localhost:3000`)
- ✅ Works against the deployed Vercel URL once `/api/plan` is reachable
- ⏳ Live screencaps of the script running inside the Antigravity CLI + IDE
  go in `docs/screenshots/` if the hackathon day's time budget allows.
  If they don't, the README's "Antigravity CLI / IDE" subsection is
  marked best-effort and the four-surfaces narrative steps down to
  three (AI Studio + Managed Agents + this portable skill).
