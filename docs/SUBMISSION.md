# Cerebralvalley.ai submission copy

Pre-written paste-ready text for the May 23, 2026 Google I/O Hackathon
submission form (5 PM PT deadline). Pick the variant that fits each field.

---

## Project name

```
Heat Threshold
```

## Tagline (≤80 chars)

```
Managed Agents fan-out + Gemini Live voice bridge for outdoor heat scheduling.
```

Alt (≤60 chars):

```
Gemini 3.5 Flash Managed Agents, fanned across four surfaces.
```

---

## Project Description (the form's main text field)

Use this verbatim — covers what it is, what's distinctive, and what's new
about the implementation. ~1100 chars / ~160 words.

```
Heat Threshold answers one question: should I go outside, and when?

You type (or speak) a location, an activity, and a time. A primary Gemini
3.5 Flash agent dispatches a graph of ten sub-agents — three uploaded as
persistent Managed Agent definitions, one weather cascade (NWS → Open-
Meteo), and six deterministic sub-agents for routing, sun-shade math,
refuge scheduling, and Street View. It returns a go / delay / alternate
verdict grounded in Stull (2011) wet-bulb math and USMC 6200.1E flag
thresholds.

Same plan, three surfaces: a 2D bento dashboard, a playable WebXR HUD
over Google Photorealistic 3D Tiles, and a Gemini Live voice mode that
calls our Managed Agents pipeline as a tool — bridging the two newest
Gemini APIs through function calling.

Every run is traced by PlatAtlas, recorded to Vercel Blob by McpTape,
and replayable via McpReplay (?replay=<runId>) — the demo safety net.

Built today, 10:30 AM – 5:00 PM PT. MIT. Environmental scheduling
tool, not medical advice.
```

---

## "Does your project use managed agents? Explain how." ⭐ BOUNTY FIELD

This is the most important field for the $5k Best Use of Managed Agents
prize. ~1300 chars. Paste verbatim.

```
Yes — Managed Agents are the spine of the product, not a sprinkle.

Three persistent Agent definitions are uploaded once per process via
ai.agents.get-or-create, then driven by ai.interactions.create on every
request:

  • threshold-location-subagent  — resolves free-form location to coords
  • threshold-place-subagent     — finds real refuges with the googleMaps
                                   grounding tool + Maps Imagery widget
                                   token (per-interaction tool config)
  • threshold-synthesis-subagent — composes the verdict, locked to a
                                   strict structured-output schema with
                                   a medical-advice firewall built in
                                   (iterated in AI Studio first)

The orchestrator runs the Weather sub-agent (NWS cascade) and the
Place managed agent in PARALLEL via Promise.all — the canonical
Managed Agents parallel-agent pattern — then serializes into Synthesis.
Six deterministic sub-agents (RouteDirections, RouteOptimization,
NavigationArrows, SunPath, RefugeBreak, StreetViewPano) consume the
output. All ten land in PlanResult.agentTrace[].

Two extension points show Managed Agents reach beyond the dashboard:

  1. Antigravity CLI/IDE skill (scripts/threshold-plan.ts) — same
     ai.interactions.create calls invoked from a developer's terminal.

  2. Gemini Live voice mode — a Live-capable preview model calls
     runThresholdPlan as a tool; the browser proxies that to /api/plan;
     the SAME three Managed Agents run. We bridged Gemini Live and
     Managed Agents through function calling because Live API doesn't
     yet run on 3.5 Flash directly.

Code: src/lib/agents/managedAgents.ts + orchestrator.ts.
```

---

## Short pitch (≤300 chars, for short-form fields)

```
Heat Threshold turns "where + activity + time" into go/delay/alternate
using Gemini 3.5 Flash Managed Agents — Location + Place + Synthesis
running in parallel, plus a WebXR HUD and a Gemini Live voice bridge
that calls the same managed agents as a tool.
```

(298 chars.)

---

## What problem does it solve?

```
Outdoor heat scheduling is a guess. Weather apps show dry-bulb
temperature, but humidity is what kills exertion plans. Heat Threshold
computes wet-bulb (Stull 2011), maps it to USMC environmental training
flags, and tells you specifically what to do: go now, delay until 6pm,
or take this alternate route past shaded refuges. Military-grade
scheduling math, civilian use case.
```

## Why is this novel?

```
Four things at once:

  1. Real use of the Managed Agents API — three persistent Agent
     definitions running in parallel fan-out, not just function
     calling on a single model.

  2. Gemini Live ↔ Managed Agents bridge. Voice Mode in the dashboard
     opens a Live-capable preview model; the Live model calls our
     managed-agents pipeline as a tool. To my knowledge nobody else
     bridged the two newest Gemini APIs in a single product today.

  3. Trace/record/replay stack — PlatAtlas + McpTape (Vercel Blob) +
     McpReplay — makes the demo deterministic even when the network
     drops on stage. Click ?replay=<id> and the dashboard hydrates
     from cached managed-agent responses.

  4. WebXR HUD with Google Photorealistic 3D Tiles + NOAA-derived
     sun-shade overlay + IMU head-tracking + glass info panels.
     Judges literally see which segments of the trail are sun-baked.
```

---

## "How are you using Gemini 3.5 Flash?" (if asked separately)

```
Gemini 3.5 Flash is fanned across four surfaces in this single project:

  1. AI Studio — iterated the SynthesisSubAgent system prompt (the
     wet-bulb / USMC flag mapping + medical-advice firewall) against
     three real input cases before committing.
  2. Antigravity CLI / IDE — a /threshold-plan skill that drives the
     production endpoint from the developer's terminal.
  3. Managed Agents API — three persistent Agents in production,
     invoked via ai.interactions.create with parallel fan-out.
  4. Gemini Live — voice front-end that delegates to the same Managed
     Agents pipeline via function calling (Live API doesn't run on
     3.5 Flash directly yet, so the bridge is the integration story).

Same model family, four surfaces, one product.
```

---

## Tech stack tags

```
Gemini 3.5 Flash · Managed Agents API · Gemini Live API · TypeScript ·
React 19 · Vite · Express · Vercel (Fluid Compute + Blob) · Tailwind ·
xrblocks · 3d-tiles-renderer · Google Maps Platform · NWS · Open-Meteo
```

---

## Categories / prize eligibility

- 1st place ($7,500 + Google AI Futures Fund call)
- **Best Use of Managed Agents ($5,000)** — primary target
- Best Use of Gemini 3.5 Flash (implicit, given four-surface story)

---

## 30-second verbal pitch (memorize for live demo Q&A)

> Heat Threshold answers a single question: should I go outside, and
> when? You give it a location, an activity, and a time — by typing
> or by voice. A primary Gemini 3.5 Flash agent dispatches three
> Managed Agents in parallel — Location, Place, and Synthesis — plus
> a Weather cascade and six deterministic sub-agents. The verdict
> comes back grounded in Stull wet-bulb math and USMC flag thresholds.
> Same plan, three surfaces: a 2D dashboard, a WebXR spatial HUD,
> and a Gemini Live voice mode that calls our managed agents as a
> tool. Every run is traced and replayable, so the demo is
> deterministic.

---

## 3-minute live-demo script

**0:00 – 0:25 — Setup.** "Heat Threshold answers one question — should
I go outside, and when. I built it today on Gemini 3.5 Flash Managed
Agents. Let me show you all three surfaces in three minutes."

**0:25 – 1:10 — Dashboard.** Click `🚵‍♂️ SF SCENIC ROUTE (GO)` →
verdict card animates → narrate: "Primary agent dispatched Location +
Place + Synthesis Managed Agents in parallel. Result: GO. Peak wet-bulb
74°F, white flag. Three refuges grounded by Google Maps Imagery." Open
trace viewer → point at parallel Weather/Place spans.

**1:10 – 1:55 — Voice Mode.** Click Voice Mode → say "I want to bike
from Zilker Park at 1 PM today." → Live model speaks the verdict back.
Narrate: "Gemini Live and Managed Agents bridged through function
calling. Live API doesn't run on 3.5 Flash yet, so the Live model
calls our managed-agents pipeline as a tool. Same three Agents."

**1:55 – 2:35 — Spatial HUD.** Click Cinematic Preview → route projects
over Photorealistic 3D Tiles → narrate: "Same plan, third surface.
NOAA solar-shade overlay, hydration beacons at each refuge, glass info
panels with the verdict."

**2:35 – 3:00 — Replay safety net.** Open `?replay=<runId>` in a new
tab → identical dashboard. "Every run is traced and replayable from
Vercel Blob. The demo is deterministic even if the network drops."

---

## URLs (replace before submitting)

| Field | Value |
|---|---|
| Live demo URL | `TODO_PROD_URL` |
| GitHub repo | `https://github.com/HeatThreshold/HeatThreshold` |
| Video URL | `TODO_VIDEO_URL` |
| Sample trace | `TODO_PROD_URL/trace/TODO_RUNID` |
| Sample replay | `TODO_PROD_URL/?replay=TODO_RUNID` |

Replace all four at once:

```bash
sed -i.bak \
  -e 's|TODO_PROD_URL|https://heat-threshold.vercel.app|g' \
  -e 's|TODO_VIDEO_URL|https://youtu.be/XXXXXXXXXXX|g' \
  -e 's|TODO_RUNID|abc123de-...|g' \
  docs/SUBMISSION.md README.md && rm docs/SUBMISSION.md.bak README.md.bak
```

---

## Author

Craig Merry · solo · MIT.

Prior-work disclosure: previously built HeatSentry (private Flutter
heat-monitoring app). No HeatSentry code, assets, copy, or services
are used in Heat Threshold. This repo was created May 23, 2026 and
every line was written during the hackathon window.
