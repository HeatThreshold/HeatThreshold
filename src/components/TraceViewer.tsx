import React, { useEffect, useState } from 'react';
import { ChevronRight, Activity, Cpu, ExternalLink, CheckCircle2, XCircle, Clock } from 'lucide-react';

interface PlatAtlasSpan {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  status: 'running' | 'success' | 'failed';
  attributes: Record<string, string | number | boolean>;
  outputSummary?: string;
  error?: string;
  children: PlatAtlasSpan[];
}

interface TraceResponse {
  runId: string;
  recordedAt: string;
  request: { location: string; activity: string; time: string };
  spans: PlatAtlasSpan;
  result: { verdict: string; flag: string; wetBulbPeakF: number; headline: string };
}

interface TraceViewerProps {
  runId: string;
}

export function TraceViewer({ runId }: TraceViewerProps) {
  const [data, setData] = useState<TraceResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/trace/${runId}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(setData)
      .catch(e => setErr(e.message));
  }, [runId]);

  if (err) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-rose-200 rounded-2xl p-8 max-w-md text-center shadow-sm">
          <XCircle className="w-10 h-10 text-rose-500 mx-auto mb-3" />
          <h2 className="font-bold text-slate-900 mb-1">Trace Not Found</h2>
          <p className="text-sm text-slate-500">{err}</p>
          <a href="/" className="inline-block mt-4 text-xs font-mono font-bold text-[#1a73e8] uppercase tracking-wider hover:underline">
            ← Back to dashboard
          </a>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-500 font-mono text-sm">
          <div className="w-5 h-5 border-2 border-[#1a73e8] border-t-transparent rounded-full animate-spin"></div>
          Loading PlatAtlas span tree for {runId}…
        </div>
      </div>
    );
  }

  const totalMs = data.spans.durationMs;

  return (
    <div className="min-h-screen bg-[#f1f5f9] text-slate-900 font-sans p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <header className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-widest text-[#202124]/50 mb-2">
            <Cpu className="w-4 h-4 text-[#1a73e8]" /> PlatAtlas Span Tree · McpTape Recording
          </div>
          <h1 className="text-xl font-black tracking-tight text-slate-900 mb-1">
            Run <span className="font-mono text-[#1a73e8]">{data.runId.slice(0, 8)}</span>
          </h1>
          <p className="text-xs text-slate-500 font-mono">
            recorded {new Date(data.recordedAt).toLocaleString()} · total {totalMs}ms · {countSpans(data.spans)} spans
          </p>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <Stat label="Verdict" value={data.result.verdict.toUpperCase()} />
            <Stat label="Flag" value={data.result.flag.toUpperCase()} />
            <Stat label="Peak Wet-Bulb" value={`${data.result.wetBulbPeakF}°F`} />
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-[10px] font-mono">
            <a
              href={`/?replay=${data.runId}`}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#e8f0fe] hover:bg-[#d2e3fc] text-[#1a73e8] font-bold rounded-lg border border-[#aecbfa] uppercase tracking-tight"
            >
              <ExternalLink className="w-3 h-3" /> Replay this run on dashboard
            </a>
            <a
              href={`/api/replay/${data.runId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg border border-slate-300 uppercase tracking-tight"
            >
              <ExternalLink className="w-3 h-3" /> Raw JSON
            </a>
            <a href="/" className="inline-flex items-center gap-1 px-2.5 py-1 text-slate-500 font-bold uppercase tracking-tight">
              ← Dashboard
            </a>
          </div>
        </header>

        <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#202124]/40 font-mono flex items-center gap-1.5 mb-4">
            <Activity className="w-4 h-4 text-[#1a73e8]" /> Span Tree
          </h2>
          <div className="space-y-1">
            <SpanRow span={data.spans} depth={0} totalMs={totalMs} />
          </div>
        </section>

        <section className="bg-slate-100 border border-slate-200 rounded-2xl p-5 shadow-sm">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#202124]/40 font-mono mb-2">
            Request
          </h3>
          <pre className="text-xs font-mono text-slate-700 whitespace-pre-wrap leading-relaxed">
{JSON.stringify(data.request, null, 2)}
          </pre>
        </section>
      </div>
    </div>
  );
}

function countSpans(s: PlatAtlasSpan): number {
  return 1 + s.children.reduce((acc, c) => acc + countSpans(c), 0);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
      <div className="text-[9px] font-mono font-bold uppercase tracking-widest text-slate-400">{label}</div>
      <div className="text-base font-black text-slate-800 mt-0.5">{value}</div>
    </div>
  );
}

function SpanRow({ span, depth, totalMs }: { span: PlatAtlasSpan; depth: number; totalMs: number }) {
  const widthPct = totalMs > 0 ? Math.max(2, (span.durationMs / totalMs) * 100) : 100;
  const StatusIcon = span.status === 'success' ? CheckCircle2 : span.status === 'failed' ? XCircle : Clock;
  const iconColor =
    span.status === 'success' ? 'text-emerald-500' :
    span.status === 'failed' ? 'text-rose-500' :
    'text-amber-500 animate-pulse';

  return (
    <div>
      <div className="flex items-start gap-2 py-1.5" style={{ paddingLeft: depth * 18 }}>
        {depth > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-300 mt-1 shrink-0" />}
        <StatusIcon className={`w-4 h-4 shrink-0 mt-0.5 ${iconColor}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-mono font-bold text-[#1a73e8] truncate">{span.name}</span>
            <span className="text-[10px] font-mono text-slate-400 shrink-0">{span.durationMs}ms</span>
          </div>
          <div className="mt-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${
                span.status === 'success' ? 'bg-emerald-400' :
                span.status === 'failed' ? 'bg-rose-400' : 'bg-amber-400'
              }`}
              style={{ width: `${widthPct}%` }}
            />
          </div>
          {span.outputSummary && (
            <p className="text-[10px] text-slate-500 font-mono mt-1 leading-snug truncate">{span.outputSummary}</p>
          )}
          {Object.keys(span.attributes).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {Object.entries(span.attributes).filter(([k]) => k !== 'runId').slice(0, 4).map(([k, v]) => (
                <span key={k} className="text-[9px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">
                  {k}={String(v)}
                </span>
              ))}
            </div>
          )}
          {span.error && (
            <p className="text-[10px] text-rose-600 font-mono mt-1">⚠ {span.error}</p>
          )}
        </div>
      </div>
      {span.children.map(c => (
        <React.Fragment key={c.spanId}>
          <SpanRow span={c} depth={depth + 1} totalMs={totalMs} />
        </React.Fragment>
      ))}
    </div>
  );
}
