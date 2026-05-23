import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, X, Loader2 } from 'lucide-react';
import { VoiceSession, type VoiceStatus } from '../lib/voice/liveClient';
import type { PlanResult } from '../lib/types';

interface VoiceModeProps {
  onClose: () => void;
  onPlan: (plan: PlanResult) => void;
}

interface Turn {
  who: 'user' | 'assistant';
  text: string;
  ts: number;
}

export function VoiceMode({ onClose, onPlan }: VoiceModeProps) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [statusDetail, setStatusDetail] = useState<string>('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const sessionRef = useRef<VoiceSession | null>(null);

  useEffect(() => {
    const session = new VoiceSession({
      onStatus: (s, detail) => {
        setStatus(s);
        if (detail) setStatusDetail(detail);
        else setStatusDetail('');
      },
      onTranscript: (turn) => {
        setTurns(prev => [...prev, { who: turn.who, text: turn.text, ts: Date.now() }]);
      },
      onPlan,
      onError: (e) => setErrorMsg(e.message)
    });
    sessionRef.current = session;
    session.start().catch(() => { /* surfaced via onError */ });
    return () => session.stop();
  }, [onPlan]);

  const statusLabel: Record<VoiceStatus, string> = {
    idle:           'Idle',
    connecting:     'Connecting to Gemini Live…',
    listening:      'Listening',
    thinking:       'Thinking',
    speaking:       'Speaking',
    'tool-running': `Running ${statusDetail || 'plan'}…`,
    error:          `Error${statusDetail ? `: ${statusDetail}` : ''}`,
    closed:         'Session closed'
  };

  const statusColor: Record<VoiceStatus, string> = {
    idle:           'bg-slate-100 text-slate-700 border-slate-200',
    connecting:     'bg-[#fef7e0] text-[#b06000] border-[#fde293]',
    listening:      'bg-[#e6f4ea] text-[#137333] border-[#a3cfbb]',
    thinking:       'bg-[#e8f0fe] text-[#1a73e8] border-[#aecbfa]',
    speaking:       'bg-[#e8f0fe] text-[#1a73e8] border-[#aecbfa]',
    'tool-running': 'bg-[#fef7e0] text-[#b06000] border-[#fde293]',
    error:          'bg-[#fce8e6] text-[#c5221f] border-[#f5c2c1]',
    closed:         'bg-slate-100 text-slate-500 border-slate-200'
  };

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 text-white shadow-2xl relative">
        <div className="flex items-start justify-between mb-1 gap-3">
          <div>
            <h2 className="text-lg font-black tracking-tight uppercase flex items-center gap-2 text-blue-400">
              <Mic className="w-5 h-5" /> Heat Threshold · Voice Mode
            </h2>
            <p className="text-[10px] font-mono tracking-wide text-indigo-300 uppercase mt-1">
              Gemini Live ↔ Managed Agents bridge. Speak your plan; the model calls <code className="bg-zinc-800 px-1 rounded">runThresholdPlan</code> and reads the verdict back.
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-300"
            aria-label="Close voice mode"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-3 mt-4 border-y border-slate-800 py-3">
          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider border ${statusColor[status]}`}>
            {(status === 'connecting' || status === 'tool-running' || status === 'thinking') && (
              <Loader2 className="w-3 h-3 animate-spin" />
            )}
            {status === 'listening' && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#34A853] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#34A853]"></span>
              </span>
            )}
            {statusLabel[status]}
          </div>
          <p className="text-[11px] text-slate-400 leading-tight">
            Try: <span className="font-mono text-slate-200">"I want to bike from the Ferry Building to Crissy Field at 2:30 PM."</span>
          </p>
        </div>

        {errorMsg && (
          <div className="mt-4 bg-[#fce8e6]/15 border border-[#f5c2c1]/40 rounded-xl p-3 text-[11px] text-rose-300 leading-relaxed">
            <strong className="font-bold uppercase tracking-wider font-mono text-[10px]">Live API error · </strong>
            {errorMsg}
            <p className="mt-1 text-rose-300/70">
              Most common cause: <code className="bg-rose-950/40 px-1 rounded">LIVE_API_MODEL</code> is not a Live-capable model for the current key. Confirm with <code className="bg-rose-950/40 px-1 rounded">curl /api/health</code> that <code className="bg-rose-950/40 px-1 rounded">hasGeminiKey</code> is true.
            </p>
          </div>
        )}

        <div className="mt-4 min-h-[200px] max-h-[340px] overflow-y-auto bg-slate-950/60 border border-slate-800 rounded-xl p-3 space-y-2 font-mono text-[11px]">
          {turns.length === 0 && (
            <p className="text-slate-500 text-center py-12 leading-relaxed">
              Talk to begin. Heat Threshold will ask for your location, activity, and start time,<br />
              then call the same 10-sub-agent graph the dashboard uses.
            </p>
          )}
          {turns.map((t, i) => (
            <div key={i} className={`flex gap-2 ${t.who === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[78%] px-3 py-2 rounded-xl ${
                t.who === 'user'
                  ? 'bg-[#1a73e8]/15 border border-[#1a73e8]/30 text-[#aecbfa]'
                  : 'bg-zinc-800/60 border border-zinc-700 text-zinc-200'
              }`}>
                <div className="text-[8px] uppercase font-bold tracking-widest text-slate-400 mb-0.5">
                  {t.who === 'user' ? 'You' : 'Heat Threshold'}
                </div>
                {t.text}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-800 pt-4">
          <p className="text-[9px] font-mono text-slate-500 uppercase tracking-wider leading-relaxed">
            Ephemeral token · single-use · 2-min session window<br />
            Tool call: <span className="text-slate-300">runThresholdPlan → /api/plan</span>
          </p>
          <button
            onClick={() => { sessionRef.current?.stop(); onClose(); }}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-500 rounded-xl font-bold uppercase tracking-wider text-[11px] flex items-center gap-1.5 shrink-0"
          >
            <MicOff className="w-3.5 h-3.5" /> End Session
          </button>
        </div>
      </div>
    </div>
  );
}
