export type EnvironmentalFlag = 'white' | 'green' | 'yellow' | 'red' | 'black';

export interface FlagThreshold {
  flag: EnvironmentalFlag;
  minTempF: number;
  maxTempF: number;
  colorClass: string;
  badgeBg: string;
  textClass: string;
  description: string;
  guidelines: string;
}

export const FLAG_THRESHOLDS: Record<EnvironmentalFlag, FlagThreshold> = {
  white: {
    flag: 'white',
    minTempF: 0,
    maxTempF: 79.9,
    colorClass: 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-800',
    badgeBg: '#f1f5f9',
    textClass: 'text-slate-800 dark:text-slate-200',
    description: 'Extremely Low Stress Conditions',
    guidelines: 'Safe environmental thermal footprint. Continue normal training, operations, and athletic schedules. Standard hydration rules apply.'
  },
  green: {
    flag: 'green',
    minTempF: 80,
    maxTempF: 84.9,
    colorClass: 'bg-emerald-100 text-emerald-850 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
    badgeBg: '#10b981',
    textClass: 'text-emerald-800 dark:text-emerald-300',
    description: 'Moderate Exposure Alert',
    guidelines: 'Pay closer attention to water intake and physical exhaustion. Ensure non-adapted individuals are monitored.'
  },
  yellow: {
    flag: 'yellow',
    minTempF: 85,
    maxTempF: 87.9,
    colorClass: 'bg-amber-100 text-amber-850 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
    badgeBg: '#fbbf24',
    textClass: 'text-amber-800 dark:text-amber-300',
    description: 'High Heat Strain Potential',
    guidelines: 'Strenuous athletics and survival activities should be moderated for personnel who lack heat adaptation. Regular cooling breaks required.'
  },
  red: {
    flag: 'red',
    minTempF: 88,
    maxTempF: 89.9,
    colorClass: 'bg-rose-100 text-rose-850 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900',
    badgeBg: '#f43f5e',
    textClass: 'text-rose-800 dark:text-rose-300',
    description: 'Severe Thermal Hazard',
    guidelines: 'Strenuous outdoor exposures and heavy physical training should be suspended of non-acclimatized personnel. Maximum of 6 hours exposure.'
  },
  black: {
    flag: 'black',
    minTempF: 90,
    maxTempF: 200,
    colorClass: 'bg-zinc-900 text-red-400 border-zinc-700 dark:bg-black dark:text-red-500 dark:border-red-950',
    badgeBg: '#18181b',
    textClass: 'text-zinc-950 dark:text-zinc-50',
    description: 'Maximum Black Flag Danger',
    guidelines: 'All non-essential physical exertion, outdoor training, and active transport schedules must be fully halted or postponed. High dry-bulb thermal risk.'
  }
};

export function getFlagForWetBulb(wetBulbF: number): EnvironmentalFlag {
  if (wetBulbF < 80) return 'white';
  if (wetBulbF < 85) return 'green';
  if (wetBulbF < 88) return 'yellow';
  if (wetBulbF < 90) return 'red';
  return 'black';
}
