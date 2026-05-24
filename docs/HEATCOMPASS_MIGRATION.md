# HeatThreshold → HeatCompass Migration Plan

Intake document for the HeatCompass organization. The goal is to fold the
durable parts of HeatThreshold (the hackathon prototype) into HeatCompass so
the org can pursue three B2B wedges: **occupational safety SaaS**,
**endurance event ops**, and **insurance / workers' comp risk scoring**.

This document is structured as a handoff packet plus an intake
questionnaire. The HeatCompass maintainers should treat the questionnaire as
the blocking input — answers determine which migration phases are real and
which are deferred.

---

## 1. What HeatThreshold actually contains (transferable inventory)

Categorized by how portable the asset is.

### A. Pure-function core (highest-value, easiest to lift)

| Asset | Location | Notes |
|---|---|---|
| Wet-bulb math (Stull 2011) | `src/lib/weatherService.ts` | Deterministic; no deps |
| USMC 6200.1E flag mapping | `src/lib/flags.ts` → `getFlagForWetBulb()` | white / green / yellow / red / black thresholds |
| Refuge break scheduler (work/rest ratios per flag) | `src/lib/agents/orchestrator.ts:792` (`RefugeBreakSubAgent`) | Encodes the MCO 6200.1F-derived ratios |
| Verdict promotion (`go` / `delay` / `alternate`) | `src/lib/agents/orchestrator.ts:1149-1184` (`runWatchTick`) | Pure function over flag transitions |

These four pieces are the actual IP. Everything below is plumbing or UX.

### B. Weather ingest

| Asset | Location | Notes |
|---|---|---|
| NWS → Open-Meteo cascade with simulated fallback | `src/lib/weatherService.ts` | Free, keyless |
| Hourly forecast sampling for peak-WBGT-over-window | `getHourlyForecasts()` | Used by both `/api/plan` and `/api/watch/tick` |

### C. Audit / compliance surface

| Asset | Location | Notes |
|---|---|---|
| **McpTape** — full run persistence | `src/lib/observability/mcptape.ts` | Vercel Blob backend + filesystem fallback. **This is the artifact a safety officer / race director / claims adjuster wants.** |
| **McpReplay** — deterministic playback | `src/lib/observability/mcpreplay.ts` | Re-runs a past decision against the same inputs and LLM responses |
| **PlatAtlas** — span tree per run | `src/lib/observability/platatlas.ts` | OpenTelemetry-shaped trace embedded in each `PlanResult` |

### D. Monitoring loop (foundation, incomplete)

| Asset | Location | Notes |
|---|---|---|
| `/api/watch/tick` endpoint | `src/server/createApp.ts:129` | Re-evaluates weather + flag only |
| 60-second client poll + verdict promotion | `src/App.tsx:68-190` | Browser-driven today; not a server cron |
| **Gap:** no persistent watch, no push, no flag-change webhook | — | The "MonitorSubAgent" referenced in README §250 is unimplemented |

### E. Managed Gemini agents (3 of them)

| Asset | Location | Notes |
|---|---|---|
| `threshold-location-subagent` | `managedAgents.ts` | Free-text → lat/lng + waypoints |
| `threshold-place-subagent` | `managedAgents.ts` | Refuge discovery via Maps Grounding |
| `threshold-synthesis-subagent` | `managedAgents.ts` | Composes verdict + headline; has a medical-advice firewall |

Useful but not core to the B2B wedges — synthesis is mostly narrative.

### F. Deterministic sub-agents (7)

Weather, RouteDirections, RouteOptimization, NavigationArrows, SunPath,
RefugeBreak, StreetViewPano. All in `src/lib/agents/orchestrator.ts`.
Route* and Sun* are useful for endurance events; the rest are demo-side.

### G. Demo-side surfaces (probably **not** worth migrating)

XR/Photorealistic 3D Tiles floor, Voice mode (Gemini Live bridge), Live
Activity preview, McpReplay browser UI. Polish; not load-bearing for B2B.

---

## 2. Mapping inventory → business wedges

### Wedge 1 — Occupational Safety SaaS (highest-priority)

**Buyer:** safety director at construction GC, landscaping, ag, utilities,
warehouse/logistics, film production.
**Trigger:** OSHA's finalizing heat-injury-and-illness-prevention standard.
**Willingness to pay:** $X00 / site / month, real compliance budget.

| What we already have | What HeatCompass needs to add |
|---|---|
| Flag engine (A) | Per-site geofence + multi-worker model |
| Weather cascade (B) | Shift-schedule ingest (workday windows, not arbitrary times) |
| McpTape audit trail (C) | OSHA-format PDF / CSV decision log export |
| Refuge break scheduler (A) | Worker acknowledgment / sign-off flow |
| `/api/watch/tick` foundation (D) | **Persistent MonitorSubAgent** + push (SMS/email/PWA) on flag escalation |
| — | Aggregate "all sites" dashboard for HQ safety |
| — | Hydration / break-taken logging (closes the audit loop) |

### Wedge 2 — Endurance Event Ops

**Buyer:** race director (marathon, tri, MTB, ultra) or event insurer.
**Trigger:** liability exposure when participants die from heat.

| What we already have | What HeatCompass needs to add |
|---|---|
| Flag engine + wet-bulb (A) | Course / aid-station model (vs. arbitrary waypoints) |
| Route polyline + WBGT-timeline per route (F) | Participant cohort projections (waves, paces) |
| RouteOptimization + RefugeBreak (F, A) | Race-day timeline view + go/delay/shorten-course decision |
| McpTape paper trail (C) | Post-event report (PDF, defensible) |
| — | Pre-event briefing pack for medical / aid stations |

### Wedge 3 — Insurance / Workers' Comp Risk

**Buyer:** underwriter or claims analyst at outdoor-worker carrier.
**Trigger:** new OSHA rule shifts risk; carriers want data-driven pricing.

**This wedge wants an API, not a UI.** Strip everything else.

| What we already have | What HeatCompass needs to add |
|---|---|
| Flag engine (A) — pure function | Batch endpoint: `POST /api/risk-score/batch` |
| Wet-bulb model (A) | **Historical scoring** — same engine against past dates (claims defense) |
| McpTape audit trail (C) | Policy-bound webhooks + aggregate risk timeseries |
| — | Underwriter dashboard (cohort-level, not per-worker) |

---

## 3. Proposed migration phases

Each phase is independently shippable. Don't start phase N+1 until phase N's
intake questions are resolved.

### Phase 0 — Discovery (this document)
Output: HeatCompass maintainers answer §4 below.

### Phase 1 — Extract the pure-function core
Lift §1.A + §1.B into a portable package (`@heatcompass/heat-engine`):

- Wet-bulb math
- USMC flag mapping
- Refuge break scheduler
- Weather cascade (NWS → Open-Meteo → simulated)
- Pure verdict promotion

Zero LLM dependency. Zero UI dependency. Vitest covered.
**Unblocks all three wedges.**

### Phase 2 — Audit trail SDK
Extract McpTape + PlatAtlas into `@heatcompass/audit`:

- Pluggable storage backend (Blob / S3 / Postgres)
- Decision log → CSV / PDF export
- Deterministic replay for claims / litigation defense

**Unblocks Wedge 1 and Wedge 3.**

### Phase 3 — MonitorSubAgent (the missing piece)
Convert the browser-side 60s poll into a real server-side persistent watch:

- Per-site cron (15-min default)
- Verdict-change detection
- Push fan-out (provider TBD — see §4)
- Webhook for downstream integrations

**Unblocks Wedge 1 (the actual sale).**

### Phase 4 — Wedge-specific surfaces
- **1:** Multi-site safety dashboard + worker acknowledgment
- **2:** Race-director console + course/aid-station model
- **3:** Risk-score API + underwriter dashboard

Order by which wedge HeatCompass actually wants to sell first.

### What we explicitly leave behind
XR / 3D Tiles, Voice mode, Live Activity preview, the consumer demo
framing. These don't serve any B2B buyer and would dilute the product.

---

## 4. Intake questionnaire for HeatCompass maintainers

These answers gate the migration plan. Please answer inline.

**Architecture & stack**
1. What's the HeatCompass stack? (Language, framework, deploy target, DB.)
2. How is multi-tenancy modeled today? (Org → site → worker? Org → event?)
3. What auth / identity does HeatCompass use, and does it cover both an internal-employee model (Wedge 1) and external API consumers (Wedge 3)?

**Existing capability**
4. Do you already have wet-bulb / WBGT / USMC flag logic in some form? If yes, do we replace, merge, or call yours? If no, can we drop in `@heatcompass/heat-engine` as a new package?
5. Do you persist decisions today, and in what shape? (We need to know whether McpTape replaces, extends, or sidecars your audit story.)
6. What's your notification backbone? (Twilio, SendGrid, OneSignal, native PWA, none yet?) Phase 3 depends on this.

**Market posture**
7. Is HeatCompass already selling into any of the three wedges? Which one is priority?
8. Any existing customer commitments or pilots whose requirements we should design against?
9. For Wedge 1: do you have an OSHA-rule reading you're targeting? (The proposed standard has shifted; we should align on which version's thresholds we map to.)
10. For Wedge 2: do you have race-director customers today, or is this greenfield?
11. For Wedge 3: any carrier relationships? What ingest format do they accept (CSV, FHIR-ish, ACORD, bespoke)?

**Constraints**
12. Are Gemini managed agents acceptable, or do you need vendor-neutral LLM (Anthropic / OpenAI / multi-provider)? This determines whether §1.E ports or gets rewritten.
13. SOC 2 / HIPAA / state-privacy posture? Affects what worker-PII fields we can carry across.
14. Cost ceiling per decision? (Drives whether MonitorSubAgent uses Gemini synthesis on every tick or only on flag changes — current code is the latter.)
15. Any IP / licensing constraints — is HeatCompass open-source, source-available, or proprietary?

**Process**
16. Preferred handoff mechanism: PRs into a HeatCompass repo, a new sub-repo, or a separate `@heatcompass/heat-engine` package we publish?
17. Who owns review / merge on the receiving side?
18. Timeline expectations — is this a "fold in over a quarter" exercise or a "ship a pilot in 6 weeks" exercise?

---

## 5. Concrete first ask of HeatCompass

Before any code moves, we want a 30-minute sync that produces:

- Answers to the §4 questionnaire (even rough ones).
- A pick of **one** wedge to drive Phase 1's scope decisions.
- Agreement on the handoff mechanism (§4 Q16).

Once those three are decided, Phase 1 (the pure-function core extraction) is
~1–2 weeks of focused work and unblocks every downstream phase.

---

## Appendix — File / line index of transferable assets

| Asset | File | Lines |
|---|---|---|
| Flag mapping | `src/lib/flags.ts` | full file |
| Wet-bulb + weather cascade | `src/lib/weatherService.ts` | full file |
| Refuge break scheduler | `src/lib/agents/orchestrator.ts` | 792– (RefugeBreakSubAgent) |
| Watch tick + verdict promotion | `src/lib/agents/orchestrator.ts` | 1136–1184 |
| McpTape | `src/lib/observability/mcptape.ts` | full file |
| McpReplay | `src/lib/observability/mcpreplay.ts` | full file |
| PlatAtlas | `src/lib/observability/platatlas.ts` | full file |
| Managed Gemini agents | `src/lib/agents/managedAgents.ts` | full file |
| `/api/watch/tick` server | `src/server/createApp.ts` | 129–152 |
| Live Watch client loop | `src/App.tsx` | 68–190 |
