import React from 'react';
import { FLAG_THRESHOLDS, EnvironmentalFlag } from '../lib/flags';
import { Shield, Sparkles } from 'lucide-react';

interface WetBulbBadgeProps {
  flag: EnvironmentalFlag;
  wetBulbF: number;
}

export function WetBulbBadge({ flag, wetBulbF }: WetBulbBadgeProps) {
  const threshold = FLAG_THRESHOLDS[flag];

  return (
    <div className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center gap-4 transition-all duration-300 ${threshold.colorClass}`}>
      <div className="flex items-center gap-3">
        <div 
          className="w-10 h-10 rounded-full flex items-center justify-center border shadow-sm shrink-0"
          style={{ backgroundColor: threshold.badgeBg }}
        >
          <Shield className={`w-5 h-5 ${flag === 'white' ? 'text-slate-600' : 'text-white'}`} style={flag === 'white' ? {} : { filter: 'drop-shadow(0px 1px 2px rgba(0,0,0,0.4))' }} />
        </div>
        <div>
          <div className="text-xs uppercase font-mono tracking-wider font-semibold opacity-80">
            Thermal Safety Status
          </div>
          <div className="text-lg font-bold flex items-center gap-2">
            <span className="capitalize">{flag} Flag</span>
            <span className="text-sm font-medium opacity-75">({wetBulbF}°F wet-bulb)</span>
          </div>
        </div>
      </div>
      <div className="md:border-l md:border-current/20 md:pl-4 text-xs font-medium leading-relaxed max-w-xl">
        <p className="font-semibold mb-0.5">{threshold.description}</p>
        <p className="opacity-90">{threshold.guidelines}</p>
      </div>
    </div>
  );
}
