#!/usr/bin/env -S npx tsx
/**
 * threshold-plan — Antigravity CLI / IDE skill script.
 *
 * Posts a scheduling query to a running Heat Threshold server and prints
 * the managed-agents verdict in human-friendly form. Wire this up as a
 * custom skill in the Antigravity CLI (or run directly with tsx) so the
 * same Managed Agents API the dashboard uses is reachable from the
 * developer's terminal and inline in the Antigravity IDE.
 *
 * Usage:
 *   tsx scripts/threshold-plan.ts \
 *     --location "Zilker Park, Austin, TX" \
 *     --activity "Heavy trail biking" \
 *     --time "13:00"
 *
 *   # Or with the demo preset (no LLM call):
 *   tsx scripts/threshold-plan.ts --demo zilker-bike
 *
 * Env:
 *   THRESHOLD_HOST   (default: http://localhost:3000)
 */

interface PlanRequest { location: string; activity: string; time?: string; demo?: string }

interface CoolingStop { name: string; distanceMeters: number; why: string; mapsUri?: string }
interface AgentTraceItem { agentName: string; status: string; durationMs: number; outputSummary?: string }
interface PlanResponse {
  id?: string;
  verdict: 'go' | 'delay' | 'alternate';
  departBy: string | null;
  delayUntil: string | null;
  headline: string;
  reasoning: string;
  wetBulbPeakF: number;
  flag: string;
  coolingStops: CoolingStop[];
  agentTrace: AgentTraceItem[];
  request: { location: string; activity: string; time: string };
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = 'true';
      }
    }
  }
  return out;
}

const FLAG_GLYPH: Record<string, string> = {
  white: '⚪ WHITE',
  green: '🟢 GREEN',
  yellow: '🟡 YELLOW',
  red: '🔴 RED',
  black: '⚫ BLACK'
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const host = process.env.THRESHOLD_HOST || 'http://localhost:3000';

  let body: PlanRequest;
  let url: string;
  if (args.demo) {
    url = `${host}/api/plan?demo=${encodeURIComponent(args.demo)}`;
    body = { location: '', activity: '', demo: args.demo };
  } else {
    if (!args.location || !args.activity) {
      console.error('Usage: tsx scripts/threshold-plan.ts --location "..." --activity "..." [--time "14:30"]');
      console.error('Or:    tsx scripts/threshold-plan.ts --demo sf-route|zilker-bike|hyde-park');
      process.exit(2);
    }
    url = `${host}/api/plan`;
    body = {
      location: args.location,
      activity: args.activity,
      time: args.time || new Date().toTimeString().slice(0, 5)
    };
  }

  process.stderr.write(`[threshold-plan] POST ${url}\n`);
  const t0 = Date.now();
  const res = await fetch(url, args.demo
    ? { method: 'GET' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  if (!res.ok) {
    const text = await res.text();
    console.error(`[threshold-plan] HTTP ${res.status}: ${text}`);
    process.exit(1);
  }
  const plan = await res.json() as PlanResponse;
  const elapsed = Date.now() - t0;

  const verdictBanner =
    plan.verdict === 'go' ? '\x1b[32mGO NOW\x1b[0m' :
    plan.verdict === 'delay' ? '\x1b[31mDELAY SCHEDULE\x1b[0m' :
    '\x1b[33mCONSIDER ALTERNATE\x1b[0m';

  console.log('');
  console.log(`╭─ HEAT THRESHOLD ─ ${plan.request.location}`);
  console.log(`│  Activity: ${plan.request.activity}`);
  console.log(`│  Time:     ${plan.request.time}`);
  console.log(`├─ VERDICT: ${verdictBanner}`);
  console.log(`│  ${plan.headline}`);
  if (plan.verdict === 'go' && plan.departBy) console.log(`│  Depart by: ${new Date(plan.departBy).toLocaleTimeString()}`);
  if (plan.verdict === 'delay' && plan.delayUntil) console.log(`│  Delay until: ${new Date(plan.delayUntil).toLocaleTimeString()}`);
  console.log(`├─ Peak wet-bulb: ${plan.wetBulbPeakF}°F · Flag: ${FLAG_GLYPH[plan.flag] || plan.flag}`);
  console.log(`├─ Reasoning:`);
  console.log(`│  ${plan.reasoning}`);
  if (plan.coolingStops?.length) {
    console.log(`├─ Refuges (${plan.coolingStops.length}):`);
    plan.coolingStops.slice(0, 5).forEach((stop, i) => {
      console.log(`│   ${i + 1}. ${stop.name} (${stop.distanceMeters}m) — ${stop.why}`);
    });
  }
  if (plan.agentTrace?.length) {
    console.log(`├─ Managed Agent trace (${plan.agentTrace.length} sub-agents):`);
    plan.agentTrace.forEach(t => {
      const icon = t.status === 'success' ? '✓' : t.status === 'failed' ? '✗' : '…';
      console.log(`│   ${icon} ${t.agentName.padEnd(34)} ${String(t.durationMs).padStart(5)}ms  ${t.outputSummary || ''}`);
    });
  }
  if (plan.id) {
    console.log(`├─ runId: ${plan.id}`);
    console.log(`│  Trace viewer: ${host}/trace/${plan.id}`);
    console.log(`│  Replay URL:   ${host}/?replay=${plan.id}`);
  }
  console.log(`╰─ done in ${elapsed}ms`);
}

main().catch(err => {
  console.error('[threshold-plan] fatal:', err);
  process.exit(1);
});
