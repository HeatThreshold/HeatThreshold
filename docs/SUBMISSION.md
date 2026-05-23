# Cerebralvalley.ai submission copy

Pre-written paste-ready text for the May 23, 2026 Google I/O Hackathon
submission form. Pick the variant that fits each field.

---

## Project name

```
Heat Threshold
```

## Tagline (≤80 chars)

```
Environmental scheduling that fans Gemini 3.5 Flash across four surfaces.
```

Alt (≤60 chars):

```
Managed Agents fan-out for outdoor heat scheduling.
```

---

## Short description (≤300 chars)

```
Heat Threshold turns a "where + activity + time" query into a go / delay /
alternate verdict using Gemini 3.5 Flash Managed Agents (parallel Weather +
Place + Synthesis sub-agents), with a WebXR spatial HUD, NOAA solar-shade
overlay, and full PlatAtlas trace + McpReplay safety net. Environmental
scheduling, not medical advice.
```

(298 chars.)

---

## Full description (≤1500 chars / ~180 words)

```
Heat Threshold answers a single question: should I go outside, and when?
Type a location, an activity, and a target time. A primary Gemini 3.5
Flash agent dispatches three managed sub-agents in parallel — Weather
(NWS → Open-Meteo cascade), Place (Google Maps grounding for hydration
refuges), and Synthesis (structured-output verdict). The result is a
go / delay / alternate decision grounded in Stull (2011) wet-bulb math
and USMC 6200.1E flag thresholds.

What's distinctive: I used Gemini 3.5 Flash on every Google surface
today. I tuned the synthesis system prompt in AI Studio, drove the
agent from the Antigravity CLI via a portable skill script, and run
production on the brand-new Managed Agents API — three persistent
Agent definitions invoked via ai.interactions.create.

Same plan renders as a 2D bento dashboard and as an interactive WebXR
spatial HUD with Google Photorealistic 3D Tiles, NOAA solar-shade
overlay, and live wet-bulb hot-updates.

Every run is traced by PlatAtlas, recorded by McpTape, and replayable
via McpReplay (?replay=<runId>) — that's the demo safety net.

Built today, 10:30 AM – 5:00 PM PT. MIT. Environmental scheduling
tool, not medical advice.
```

(1490 chars including blank lines, ~210 words. Trim the WebXR
paragraph if the form caps shorter.)

---

## Tech stack tags

```
Gemini 3.5 Flash · Managed Agents API · TypeScript · React 19 · Vite ·
Express · Vercel · Tailwind · xrblocks · 3d-tiles-renderer · Google Maps
Platform · NWS · Open-Meteo
```

---

## What problem does it solve?

```
Outdoor heat scheduling is a guess. Weather apps tell you the dry-bulb
temperature but humidity is what kills exertion plans. Heat Threshold
computes wet-bulb (Stull 2011), maps it to USMC environmental training
flags, and tells you specifically what to do: go now, delay until 6pm,
or take this alternate route past shaded refuges. Same algorithm armies
use for training scheduling, for civilians planning a bike ride.
```

## Why is this novel?

```
Three things at once: (1) Real use of the brand-new Gemini Managed
Agents API — three persistent Agent definitions with parallel fan-out,
not just function calling; (2) A complete trace/record/replay stack
(PlatAtlas + McpTape + McpReplay) that makes the demo deterministic
even when the network drops on stage; (3) A WebXR spatial HUD that
projects the route over Google Photorealistic 3D Tiles with a
NOAA-derived sun-shade overlay so judges literally see which segments
of the trail are sun-baked.
```

## Categories / prize eligibility

- 1st place ($7,500 + Google AI Futures Fund call)
- **Best Use of Managed Agents ($5,000)** — primary target
- Best Use of Gemini 3.5 Flash (implicit, given four-surfaces story)

---

## URLs (replace before submitting)

| Field | Value |
|---|---|
| Live demo URL | `TODO_PROD_URL` |
| GitHub repo | `https://github.com/HeatThreshold/HeatThreshold` |
| Video URL | `TODO_VIDEO_URL` |
| Sample trace | `TODO_PROD_URL/trace/TODO_RUNID` |
| Sample replay | `TODO_PROD_URL/?replay=TODO_RUNID` |

Same sed one-liner from [README.md](../README.md) Live demo section
swaps every TODO_ in this file too — pass `-e` for both files at
once.

---

## Author

Craig Merry · solo · MIT.

Prior-work disclosure: previously built HeatSentry (private Flutter
heat-monitoring app). No HeatSentry code, assets, copy, or services
are used in Heat Threshold. This repo was created May 23, 2026 and
every line was written during the hackathon window.
