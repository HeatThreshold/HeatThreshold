# heat-engine-spec — design

**Status:** Approved (brainstorming complete; awaiting implementation plan)
**Date:** 2026-05-25
**Authors:** drafted with Claude Code in a session against `HeatCompass/heatcompass` HEAD and `HeatThreshold/HeatThreshold` HEAD
**Tracking issue:** [HeatThreshold/HeatThreshold#3](https://github.com/HeatThreshold/HeatThreshold/issues/3)
**Follow-up to:** [HeatThreshold/HeatThreshold#2](https://github.com/HeatThreshold/HeatThreshold/issues/2) (`docs: HeatCompass migration plan`)

## Goal

Establish a spec-of-record for the heat-stress calculation engine shared between the HeatCompass Flutter app and the HeatThreshold TypeScript stack. Hand-authored fixtures and JSON Schemas, sourced from primary literature (Stull 2011, USMC Order 6200.1E, NOAA, etc.), become the authoritative truth. Both implementations must conform. A divergence is a bug in the implementation, not in the contract.

This work fixes a real bug — HeatThreshold's `calculateWetBulbCelsius` uses the constant `8.313765` where Stull (2011) and HeatCompass both have `8.313659`. The spec catches it and forces convergence.

## Non-goals

- Unifying the route-planning verdict envelope (`PlanOutput`) or the per-location advisory shape (`HeatAdvisory`). Those are surface-specific.
- The McpTape run envelope, `WeatherReading` interchange, or any other transport-layer schemas. If/when issue #3's decisions warrant, those ship in a sibling `heat-engine-envelope-spec` repo.
- HeatCompass's experimental `heatCompassWbgt` formula. Brand-internal, never in the spec.
- A reference JavaScript implementation or validator CLI. Explicitly out of scope per brainstorming.

## Architecture

Three repos, one contract:

```
HeatThreshold/heat-engine-spec        ← THE CONTRACT (new, this work)
   │
   ├── publishes ──► npm: @heat-engine/spec-types   (TS types + JSON Schema + fixture loader)
   └── publishes ──► pub.dev: heat_engine_spec      (Dart types + JSON Schema + fixture loader)

HeatThreshold/HeatThreshold           ← TS impl, pins @heat-engine/spec-types@^0.1.0
HeatCompass/heatcompass               ← Dart impl, pins heat_engine_spec: ^0.1.0
```

The spec repo owns the truth. Both implementation repos consume published packages — neither implementation can be the source of truth, because spec-of-record means both must conform.

## Repo layout (`heat-engine-spec`)

```
heat-engine-spec/
├── README.md                        ← scope, governance, how to add a tier
├── LICENSE                          ← MIT
├── CHANGELOG.md
├── spec/
│   ├── tier1-foundation/
│   │   ├── wet-bulb-input.schema.json
│   │   ├── wet-bulb-output.schema.json
│   │   ├── flag-mapping-input.schema.json
│   │   ├── flag-mapping-output.schema.json
│   │   ├── wet-bulb.fixtures.csv
│   │   ├── flag-mapping.fixtures.csv
│   │   └── references.md
│   ├── tier2-wbgt/                  ← later (0.2.0)
│   ├── tier3-atmospheric/           ← later (0.3.0)
│   └── tier4-apparent-temp/         ← later (1.0.0)
├── packages/
│   ├── spec-types-ts/               ← npm: @heat-engine/spec-types
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── types.ts             ← generated from schemas via json-schema-to-typescript
│   │   │   ├── fixtures.ts          ← loads CSVs (bundled bytes, no network)
│   │   │   └── index.ts
│   │   └── tsconfig.json
│   └── spec-types-dart/             ← pub.dev: heat_engine_spec
│       ├── pubspec.yaml
│       ├── lib/
│       │   ├── heat_engine_spec.dart
│       │   ├── types.dart           ← hand-authored at tier 1; generated from tier 2 onward
│       │   └── fixtures.dart        ← loads CSVs (bundled bytes, no network)
│       └── test/
├── scripts/
│   ├── generate-types.sh            ← regenerates packages from /spec
│   └── validate-fixtures.sh         ← lints CSV row shapes against schemas
└── .github/workflows/
    ├── ci.yml                       ← lint + validate on PR
    └── release.yml                  ← npm + pub publish on tag
```

`spec/` is hand-authored truth. `packages/*/src/types.{ts,dart}` is generated (TS) or hand-written-but-validated-by-test (Dart, tier 1 only). Boundary enforced in CI: `git diff --exit-code` after `generate-types.sh`.

One repo, two published packages. The cost of two publish pipelines is offset by one PR review surface, one CI, one CHANGELOG.

## Schema design

### Units convention

SI internally, Fahrenheit at the flag boundary.

- Wet-bulb, WBGT, dewpoint inputs and outputs: Celsius (matches Stull 2011, Liljegren, Magnus-Tetens).
- Flag mapping input: Fahrenheit (USMC Order 6200.1E defines boundaries at 80/85/88/90 °F in Fahrenheit; keeping the source unit avoids float-precision drama at boundary edges).
- Wind: m/s.
- Solar radiation: W/m².
- Pressure: hPa.

### Naming convention

camelCase with unit suffix in the field name. Examples: `tempC`, `rhPercent`, `wetBulbC`, `wetBulbF`, `windMs`, `solarWm2`, `pressureHpa`. Both TS and Dart parse this cleanly; units are unambiguous when reading code.

### Two schemas per formula

Each formula gets a separate input and output schema. Implementation tests validate `input.json` against `*-input.schema.json` before running the formula, and `output.json` against `*-output.schema.json` after.

### Example: wet-bulb input schema

```json
{
  "$id": "https://heat-engine.spec/tier1/wet-bulb-input.schema.json",
  "type": "object",
  "required": ["tempC", "rhPercent"],
  "additionalProperties": false,
  "properties": {
    "tempC":     { "type": "number", "minimum": -20, "maximum": 50,
                   "description": "Dry-bulb air temperature in °C. Stull (2011) validated for [-20, 50]." },
    "rhPercent": { "type": "number", "minimum": 5,   "maximum": 99,
                   "description": "Relative humidity 0-100. Stull (2011) validated for [5, 99]; implementations MUST clamp inputs to this range." }
  }
}
```

## Fixture format

CSV. Diffable in PRs, editable in any spreadsheet, parseable in both languages with zero dependencies.

### `wet-bulb.fixtures.csv` columns

```
id, source_ref, temp_c, rh_percent, expected_wet_bulb_c, expected_wet_bulb_f, tolerance_c, notes
```

| Column | Purpose |
|---|---|
| `id` | Stable id like `wb-stull-2011-table1-row3`. Implementations report this id on failure for fast root-cause. |
| `source_ref` | Citation key resolving to `references.md`. Auditability. |
| `temp_c`, `rh_percent` | Inputs. |
| `expected_wet_bulb_c` | The truth. |
| `expected_wet_bulb_f` | Redundant — lets a test catch a unit-conversion bug separately from a formula bug. |
| `tolerance_c` | Per-row tolerance. Stull paper claims ±0.65°C overall; default ±0.3°C, tighter (±0.01°C) for paper-direct rows, looser for known edge-region rows. |
| `notes` | Free text. |

### `flag-mapping.fixtures.csv` columns

```
id, source_ref, wet_bulb_f, expected_flag, expected_flag_dart_label, notes
```

Dual flag label columns (`white|green|yellow|red|black` and `low|moderate|high|extreme|critical`) let both vocabularies be tested without forcing either implementation to abandon its naming. The schema defines the canonical mapping; either vocabulary is acceptable surface syntax.

Flag fixtures don't need tolerance — exact equality.

### Tier 1 row budget

| Category | Rows |
|---|---|
| Stull 2011 validation-table rows | ~12 |
| Boundary cases (just under / at / over each USMC flag) | ~10 |
| Edge cases (very low RH, very high RH, T near validity limits) | ~8 |
| Typical conditions (temperate, humid-tropical, arid) | ~10 |
| Flag-mapping rows | ~20 |
| **Total** | **~60** |

Tier 2 (WBGT family) adds ~80-100 rows because WBGT has more input dimensions (solar + wind).

### References file

`spec/tier1-foundation/references.md` is a flat list of primary sources keyed by `source_ref`. Every fixture row's `source_ref` must resolve here. CI lints this.

```markdown
## stull-2011
Stull, R. (2011). "Wet-Bulb Temperature from Relative Humidity and Air Temperature."
*Journal of Applied Meteorology and Climatology*, 50(11), 2267-2269.
DOI: 10.1175/JAMC-D-11-0143.1

## usmc-6200-1e
U.S. Marine Corps Order 6200.1E. (2002). "Marine Corps Heat Stress Program."
Establishes WBGT-based flag boundaries: 80/85/88/90 °F.
```

## Type generation

**TS:** `json-schema-to-typescript` (`json2ts`). Standard tool, zero glue.

```bash
# scripts/generate-types.sh (TS portion)
json2ts spec/tier1-foundation/wet-bulb-input.schema.json \
  > packages/spec-types-ts/src/generated/tier1/wet-bulb-input.d.ts
```

**Dart:** No production-grade JSON-Schema-to-Dart generator exists on pub.dev. For tier 1, hand-author the ~6 Dart types in `packages/spec-types-dart/lib/types.dart`. A test ensures every type round-trips through its JSON Schema. A bespoke generator is built at tier 2 when the type count justifies the ~200-LOC investment.

## Fixture loader API

```ts
// TS
import { loadWetBulbFixtures, loadFlagMappingFixtures } from '@heat-engine/spec-types';
const fixtures: WetBulbFixtureRow[] = loadWetBulbFixtures();
```

```dart
// Dart
import 'package:heat_engine_spec/heat_engine_spec.dart';
final fixtures = loadWetBulbFixtures(); // List<WetBulbFixtureRow>
```

CSV bytes are bundled into the published package — no network, no file paths.

## Implementation repo integration

### HeatThreshold/HeatThreshold

`package.json`:
```json
{
  "devDependencies": {
    "@heat-engine/spec-types": "^0.1.0"
  }
}
```

`src/lib/wetbulb.spec.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { loadWetBulbFixtures } from '@heat-engine/spec-types';
import { calculateWetBulbCelsius } from './wetbulb';

describe('heat-engine-spec tier 1 wet-bulb conformance', () => {
  for (const fx of loadWetBulbFixtures()) {
    it(`${fx.id}: T=${fx.tempC}°C RH=${fx.rhPercent}% → ${fx.expectedWetBulbC}°C`, () => {
      const got = calculateWetBulbCelsius(fx.tempC, fx.rhPercent);
      expect(Math.abs(got - fx.expectedWetBulbC)).toBeLessThanOrEqual(fx.toleranceC);
    });
  }
});
```

This test fails today because of the `8.313765` typo. That failure is exactly the spec doing its job. The fix is to flip the constant to `8.313659`; the spec then passes.

### HeatCompass/heatcompass

`pubspec.yaml`:
```yaml
dev_dependencies:
  heat_engine_spec: ^0.1.0
```

`test/data/calculators/heat_engine_spec_conformance_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:heat_engine_spec/heat_engine_spec.dart';
import 'package:heat_sentry/data/calculators/heat_stress.dart';

void main() {
  group('heat-engine-spec tier 1 wet-bulb conformance', () {
    for (final fx in loadWetBulbFixtures()) {
      test('${fx.id}: T=${fx.tempC}°C RH=${fx.rhPercent}% → ${fx.expectedWetBulbC}°C', () {
        final got = HeatStressCalculator.wetBulbTemperature(fx.tempC, fx.rhPercent);
        expect((got - fx.expectedWetBulbC).abs(), lessThanOrEqualTo(fx.toleranceC));
      });
    }
  });
}
```

HeatCompass passes the **wet-bulb** conformance today without code changes — `HeatStressCalculator.wetBulbTemperature` already uses the correct `8.313659` constant. The **flag-mapping** conformance is a different story: HeatCompass's current flag-mapping is a getter (`HeatExposureHistory.riskLevel`) that takes WBGT in Celsius with truncated boundary constants (`26.7` / `29.4` / `31.1` / `32.2`) rather than the exact F→C conversions (`26.6667` / `29.4444` / `31.1111` / `32.2222`). The conformance test therefore requires a small additive code change: a new standalone `flagFromWetBulbF(double wetBulbF) -> HeatRiskLevel` function in `lib/data/calculators/heat_stress.dart` that takes the canonical spec input shape and uses Fahrenheit comparisons natively to avoid the truncation slop. The existing `riskLevel` getter is left alone (in-place usage doesn't change); a follow-up PR can later route it through the new function once consumer call sites are audited.

## CI design

### Spec-repo CI (`.github/workflows/ci.yml`)

Runs on every PR to `heat-engine-spec`:

1. Lint CSV row shapes (column count, numeric where required).
2. Validate JSON Schemas with `ajv compile`.
3. Verify every `source_ref` in every fixture row resolves to an entry in `references.md`.
4. Run `generate-types.sh` and `git diff --exit-code` — committed generated types must match what the schemas would produce.
5. Run TS package vitest (loader round-trip tests).
6. Run Dart package `dart test` (loader round-trip tests).

### Spec-repo release workflow

On `v*` tag: publish to npm + publish to pub.dev. Both publishes gated on CI passing.

### Consumer-side new CI jobs

```yaml
# HeatThreshold/HeatThreshold ci addition
spec-conformance:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 20 }
    - run: npm ci
    - run: npx vitest run src/lib/wetbulb.spec.test.ts
```

```yaml
# HeatCompass/heatcompass ci addition
spec-conformance:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: subosito/flutter-action@v2
      with: { channel: stable }
    - run: flutter pub get
    - run: flutter test test/data/calculators/heat_engine_spec_conformance_test.dart
```

### Failure semantics

| Cause | Resolution |
|---|---|
| Implementation regression | Fix the implementation. Test goes green. |
| Spec evolved (new boundary, tolerance tightened) | Spec PR ships → cut new version → impl PR bumps pin → impl adopts. Two-PR flow keeps "I broke parity" separate from "the contract changed." |
| Genuine disagreement on spec value | Open issue on `heat-engine-spec` with primary-source citation. Resolve before any pin bump. |

## Semver discipline

Pre-1.0 (tier rollout) follows npm convention: `0.MINOR.PATCH` where MINOR = breaking, PATCH = non-breaking.

| Bump | Trigger |
|---|---|
| **PATCH** | Fixture row additions, reference.md edits, tolerance *widening*, generated-types regen with no schema delta. |
| **MINOR** | New tier, schema field add/remove/rename, tolerance *tightening*, fixture row deletions, value corrections that flip any row's pass/fail. |
| **MAJOR (post-1.0 only)** | Breaking schema changes. |

| Release | Contents |
|---|---|
| 0.1.0 | Tier 1 — foundation (wet-bulb + flag mapping) |
| 0.2.0 | Tier 2 — WBGT family (Liljegren simplified + USMC variant, °C and °F) |
| 0.3.0 | Tier 3 — atmospheric add-ons (altitude-adjusted, equipment-adjusted, dewpoint) |
| 1.0.0 | Tier 4 — apparent-temperature siblings (heat index Rothfusz, wind chill) — commits to post-1.0 semver |

Implementation repo CI pins to a specific MINOR (e.g., `^0.1.0`). Pin bumps are deliberate.

## Tier 1 implementation order

Ten items. Items 1–8 ship 0.1.0 in the spec repo. Items 9–10 are the impl-repo adoption PRs and depend on 0.1.0 being live.

1. Create `HeatThreshold/heat-engine-spec` repo with the layout above.
2. Register `heat-engine` npm org (or fall back to `@heatthreshold/heat-engine-spec`).
3. Author wet-bulb fixtures: ~12 from Stull (2011) validation table + ~10 boundary + ~8 edge + ~10 typical.
4. Author flag-mapping fixtures: ~20 rows covering every boundary + interior + extremes.
5. Author JSON Schemas (4 files) per the example above.
6. Hand-author the 6 Dart types in `packages/spec-types-dart/lib/types.dart` + the fixture loader.
7. Run `json-schema-to-typescript` to generate TS types + author the loader.
8. Wire spec-repo CI + publish 0.1.0 to npm + pub.dev.
9. Open `HeatThreshold/HeatThreshold` PR: add dev-dep + conformance test + flip `8.313765` → `8.313659`.
10. Open `HeatCompass/heatcompass` PR: add dev-dep + add `flagFromWetBulbF()` function (small additive change to match spec input shape) + conformance test. Wet-bulb side lands green without formula changes.

## Risks

| Risk | Mitigation |
|---|---|
| **Stull 2011 paper paywalled** — fixture authoring needs the validation table | Author re-derives expected values by running the formula on selected (T, RH) pairs and cross-checks against a NOAA / USGS heat index calculator. Cite cross-check method in `references.md`. |
| **`heat-engine` npm org taken** | Fall back to `@heatthreshold/heat-engine-spec` (npm) — operator owns this org. Update package name + this design doc. |
| **pub.dev requires verified publisher** | First-time pub.dev publish needs an org email and Google account verification. Add as a pre-flight in the impl plan. |
| **HeatThreshold typo fix breaks any UI snapshot tests** | The typo causes ~0.001°C-0.05°C drift depending on RH. Unlikely to flip any visible flag in `WetBulbBadge.tsx`, but the PR must run the full TS test suite, not just the new conformance file. |
| **HeatCompass `heat_engine_spec` pub.dev package name conflict** | Search pub.dev before publishing. Fallback: `heat_compass_engine_spec`. |
| **HeatCompass `riskLevel` getter uses truncated Celsius boundaries** (`26.7` / `29.4` / `31.1` / `32.2` vs the exact `26.6667` / `29.4444` / `31.1111` / `32.2222`) | The new `flagFromWetBulbF()` introduced in tier-1 adoption uses F-native comparisons and avoids the slop. The existing getter stays for backwards compatibility; a follow-up PR can audit call sites and route them through the new function. |

## Open decisions

These were defaulted during brainstorming; user can override at spec review:

- Repo owner org: `HeatThreshold/heat-engine-spec`. Alternative: `HeatCompass/heat-engine-spec`, or a neutral org.
- npm package name: `@heat-engine/spec-types`. Alternatives noted in risks.
- License: MIT. Permissive matches the spec-of-record defensibility goal — closed spec defeats the purpose.

## Connection to issue #3 roadmap

This work is the cross-cutting "Golden engine fixtures + shared schema" row in issue #3. Tier 1 (this spec) is decision-independent — it's safe under Option A, B, or C in the framing decision. It also unblocks several downstream items in that roadmap:

- **HeatThreshold's enterprise wedges** gain a defensible audit story ("our engine conforms to a published spec at version X").
- **HeatCompass consumer track** gains the same conformance assurance and the typo fix flows downstream cleanly when HeatThreshold becomes a service tier under Option C.
- **McpTape envelope formalization** (issue #3 cross-cutting) can later sit alongside `heat-engine-spec` as a sibling repo.
