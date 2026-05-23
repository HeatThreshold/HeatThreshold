import React from 'react';
import { AgentTraceItem } from '../lib/types';
import { Cpu, CheckCircle2, XCircle, AlertCircle, Timer, ServerCrash } from 'lucide-react';

interface AgentActivityProps {
  trace: AgentTraceItem[];
}

export function AgentActivity({ trace }: AgentActivityProps) {
  if (!trace || trace.length === 0) return null;

  const totalDuration = trace.reduce((sum, item) => sum + item.durationMs, 0);

  return (
    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-inner">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3 mb-4">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-indigo-500 animate-pulse" />
          <h4 className="font-semibold text-sm text-slate-800 dark:text-slate-200 tracking-tight">
            Gemini 3.5 Flash Managed Sub-Agents Trace
          </h4>
        </div>
        <div className="flex items-center gap-1.5 text-xs font-mono font-medium text-slate-500 bg-slate-200/50 dark:bg-indigo-950/40 px-2 py-1 rounded-md">
          <Timer className="w-3.5 h-3.5" />
          Total cost: {totalDuration}ms
        </div>
      </div>

      <div className="relative border-l border-slate-200 dark:border-slate-800 ml-3.5 pl-5 space-y-5">
        {trace.map((item, index) => {
          let StatusIcon = CheckCircle2;
          let iconColor = 'text-emerald-500';

          if (item.status === 'running') {
            StatusIcon = AlertCircle;
            iconColor = 'text-amber-500 animate-spin';
          } else if (item.status === 'failed') {
            StatusIcon = XCircle;
            iconColor = 'text-rose-500';
          }

          return (
            <div key={index} className="relative group">
              {/* Timeline bubble */}
              <div className="absolute -left-[29px] top-1 bg-white dark:bg-slate-900 rounded-full p-0.5">
                <StatusIcon className={`w-4 h-4 ${iconColor}`} />
              </div>

              <div>
                <div className="flex items-baseline justify-between text-xs mb-1">
                  <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                    {item.agentName}
                  </span>
                  <span className="font-mono text-slate-400 bg-slate-200/40 dark:bg-slate-800/60 px-1.5 py-0.5 rounded">
                    {item.durationMs}ms
                  </span>
                </div>
                {item.outputSummary && (
                  <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed font-sans">
                    {item.outputSummary}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
