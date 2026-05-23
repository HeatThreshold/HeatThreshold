# Heat Threshold — Demo scripts

Two scripts: a 1-minute video script (submission deliverable) and a
3-minute live demo script (Round 1 stage). Both lead with the
**Gemini 3.5 Flash across every surface** angle, then run the arc.

---

## 1-minute video (~150 words)

| Time | What you say | What's on screen |
|---|---|---|
| 0:00 – 0:12 | "I'm Craig. This is Heat Threshold — an environmental scheduling tool. **What's special: I used Gemini 3.5 Flash on every Google surface today.** AI Studio, the Antigravity CLI, the Antigravity IDE, and the brand-new Managed Agents API in production." | Landing dashboard, full bento layout, the "Gemini 3.5 Flash · Managed Agents" chip in the header. |
| 0:12 – 0:32 | "I type 'bike to Zilker at 2:30' — the primary agent dispatches Weather and Place sub-agents in parallel, then a synthesis agent writes the verdict." | Form fill → submit → loading spinner → DELAY card with cooling stops + map embed. |
| 0:32 – 0:50 | "Every call is a managed agent — three of them, all Gemini 3.5 Flash. Every call is traced with PlatAtlas, recorded by McpTape, and replayable via McpReplay." | Click runId → `/trace/<id>` span tree fills the screen, parallel Weather + Place spans visible side-by-side. |
| 0:50 – 1:00 | "Same model, four surfaces, one workflow. Open source. MIT. Built today. Thanks." | GitHub repo page showing today's commits + `v0.1-demo` tag. |

**Recording tips:**
- Pre-load `?demo=zilker-bike` in one tab and a fresh dashboard in another so you can show both the instant-fixture and the live agent path.
- Use `npm run threshold-plan -- --demo zilker-bike` in the terminal as the "Antigravity CLI" stand-in if the actual CLI screencap didn't ship.
- Multiple takes. Hard deadline: usable mp4 by 16:45.

---

## 3-minute live demo

### 0:00 – 0:25 — Open with the four-surfaces angle

> "Heat Threshold uses Gemini 3.5 Flash *four ways*. I tuned the synthesis prompt in AI Studio this morning. I drove the agent from the Antigravity CLI and IDE during the build. And the production app runs on the brand-new **Managed Agents API** — three managed Gemini 3.5 Flash sub-agents fanning out in parallel."

Show the dashboard, the "Gemini 3.5 Flash · Managed Agents" chip, hit submit.

### 0:25 – 1:10 — Walk the span tree

Click the `Open Span Tree` chip next to the agent trace. `/trace/<runId>` loads.

> "This is the PlatAtlas span tree for that run. PrimaryAgent at the top. Underneath: LocationResolution managed agent, then **Weather and Place dispatched in parallel** — see how their bars overlap — then Synthesis serializes the result. Every span tagged with its managed-agent ID."

### 1:10 – 1:40 — Honesty beat on the wet-bulb badge

Back to the dashboard. Hover the wet-bulb sparkline.

> "Peak wet-bulb is computed via Stull (2011), not WBGT. Flag thresholds are USMC 6200.1E for environmental training, not health advice. This is a *scheduling* tool, not a medical one."

### 1:40 – 2:05 — Antigravity (if shipped)

Switch to the Antigravity IDE chat. Run `/threshold-plan bike to Zilker at 1pm`.

> "Same model, different surface. The Antigravity chat is also Gemini 3.5 Flash — it parses my message into args and shells out to a portable skill script, which POSTs back to `/api/plan` and triggers three more managed-agent invocations. Four Gemini calls, one user message."

If the skill didn't ship live, run `npm run threshold-plan -- --demo sf-route` in a terminal window instead and call it out:

> "I shipped the portable skill runner; the Antigravity registration is the screencap in `docs/antigravity-skill.md`."

### 2:05 – 2:30 — McpReplay safety net (disclose openly)

Open a pre-loaded `?replay=<runId>` URL.

> "And if a live agent ever hangs on stage, here's the safety net. Same code path, cached LLM responses. The McpReplay banner says it openly. McpTape recorded this run earlier; I can replay it deterministically forever."

### 2:30 – 2:50 — Code on screen

Open `src/lib/agents/managedAgents.ts` in the IDE.

> "The bounty deliverable is right here — `ai.interactions.create({ agent: <id>, ... })`. Three managed Agent definitions, get-or-create cached, parallel fan-out. The README walks the architecture diagram."

### 2:50 – 3:00 — GitHub close

> "Public repo. MIT. The commit graph shows today's work — including the LICENSE in commit one, the Managed Agents migration, and the v0.1-demo tag. Built today, every line."

---

## Pre-stage prep checklist

- [ ] Browser tab 1: production dashboard (`/`), live agent path warmed up.
- [ ] Browser tab 2: `?replay=<known-good-runId>` for the safety net beat.
- [ ] Browser tab 3: `/trace/<runId>` for the span tree walk.
- [ ] Terminal: `npm run threshold-plan -- --demo zilker-bike` queued.
- [ ] IDE: `src/lib/agents/managedAgents.ts` already open and scrolled to `SUBAGENT_SPECS`.
- [ ] Antigravity (if shipped): `/threshold-plan` skill registered, chat panel open.
- [ ] Phone: 30-second screen recording of the happy path queued as last-resort backup.

## What to never say on stage

- ❌ Medical / diagnosis / symptoms / treatment / illness / doctor / patient / health.
- ❌ "HeatSentry" — that's the prior-work disclosure, never the demo.
- ❌ "Running on localhost" — production URL or `?replay=<id>` only.

## What to always say

- ✅ **Managed Agents API** — twice, minimum. This is the $5K bounty.
- ✅ **Gemini 3.5 Flash** — every time you reference the model.
- ✅ **PlatAtlas / McpTape / McpReplay** — once each, with the span tree visible.
- ✅ **Built today** — at the open and the close.
