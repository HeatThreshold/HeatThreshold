import React, { useState, useEffect } from 'react';
import { demoFixtures } from './lib/demoFixtures';
import { PlanResult } from './lib/types';
import { MapEmbed } from './components/MapEmbed';
import { TraceViewer } from './components/TraceViewer';
import {
  Compass,
  MapPin,
  Activity,
  Clock,
  ShieldAlert,
  ShieldCheck,
  Cpu,
  ArrowRight,
  Search,
  ExternalLink,
  ChevronRight,
  Info,
  Layers,
  Sparkles,
  RefreshCw,
  HelpCircle,
  Eye,
  CheckCircle,
  Clock3,
  Calendar,
  AlertTriangle,
  Radio,
  Pause
} from 'lucide-react';

/**
 * Tiny client-side router. /trace/:runId renders the PlatAtlas span tree
 * viewer; everything else renders the dashboard. Vite SPA fallback in
 * server.ts catches unknown paths and serves this same index.html.
 */
export default function App() {
  const traceMatch = typeof window !== 'undefined'
    ? window.location.pathname.match(/^\/trace\/([a-zA-Z0-9_-]+)/)
    : null;
  if (traceMatch) {
    return <TraceViewer runId={traceMatch[1]} />;
  }
  return <Dashboard />;
}

function Dashboard() {
  const [locationInput, setLocationInput] = useState('SF Ferry Building, San Francisco, CA');
  const [activityInput, setActivityInput] = useState('Biking with Coit Tower climb');
  const [timeInput, setTimeInput] = useState('14:30');
  
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Start with 'sf-route' preset preloaded so the Bento Grid is beautiful and fully populated on boot
  const [currentPlan, setCurrentPlan] = useState<PlanResult>(demoFixtures['sf-route']);
  const [selectedPreset, setSelectedPreset] = useState<string>('sf-route');
  
  const [isXrModalOpen, setIsXrModalOpen] = useState(false);
  const [timeState, setTimeState] = useState('11:06 AM PDT');
  const [dateState, setDateState] = useState('May 23, 2026');
  const [hoveredHourIndex, setHoveredHourIndex] = useState<number | null>(null);

  // Live Watch state — periodic re-evaluation via /api/watch/tick.
  const [isWatching, setIsWatching] = useState(false);
  const [lastTickAt, setLastTickAt] = useState<string | null>(null);
  const [lastTickSource, setLastTickSource] = useState<'nws' | 'open-meteo' | 'simulated' | null>(null);
  const xrIframeRef = React.useRef<HTMLIFrameElement | null>(null);

  // McpReplay: when the page is opened with ?replay=<runId>, hydrate the
  // dashboard from a previously recorded run instead of generating a new one.
  // This is the demo safety net — same UI, cached LLM responses.
  const [replayBanner, setReplayBanner] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const replayId = params.get('replay');
    if (!replayId) return;
    fetch(`/api/replay/${encodeURIComponent(replayId)}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((cached: PlanResult) => {
        setCurrentPlan(cached);
        setSelectedPreset('');
        setLocationInput(cached.request.location);
        setActivityInput(cached.request.activity);
        setTimeInput(cached.request.time);
        setReplayBanner(`Replaying McpTape recording ${replayId.slice(0, 8)} — same agent code, cached LLM responses.`);
      })
      .catch(err => {
        console.warn('[McpReplay] Failed to load recording', err);
        setReplayBanner(`Replay ${replayId.slice(0, 8)} not found — showing live dashboard.`);
      });
  }, []);

  // Dynamic system clock simulator matching the user's local metadata date
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      // Keep alignment with May 23, 2026 for hackathon fidelity, but show running seconds
      const hrs = now.getHours().toString().padStart(2, '0');
      const mins = now.getMinutes().toString().padStart(2, '0');
      const secs = now.getSeconds().toString().padStart(2, '0');
      const ampm = now.getHours() >= 12 ? 'PM' : 'AM';
      setTimeState(`${hrs}:${mins}:${secs} ${ampm} PDT`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Live Watch polling — re-evaluates weather/flag/verdict every 60s while on
  // and broadcasts the freshest plan into the XR iframe via postMessage so the
  // 3D scene reflects rising wet-bulb in real time.
  useEffect(() => {
    if (!isWatching) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch('/api/watch/tick', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: currentPlan })
        });
        if (!res.ok) throw new Error(`tick ${res.status}`);
        const data = await res.json();
        if (cancelled) return;

        setCurrentPlan(prev => ({
          ...prev,
          wetBulbPeakF: data.wetBulbPeakF,
          flag: data.flag,
          verdict: data.verdict,
          headline: data.headline,
          reasoning: data.reasoning
        }));
        setLastTickAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        setLastTickSource(data.source);

        // Push the same delta to the XR iframe if it's mounted.
        const iframe = xrIframeRef.current;
        if (iframe?.contentWindow) {
          iframe.contentWindow.postMessage(
            {
              kind: 'heat-threshold/live-tick',
              wetBulb: data.wetBulbPeakF,
              flag: data.flag,
              verdict: data.verdict,
              headline: data.headline,
              reasoning: data.reasoning,
              fetchedAt: data.fetchedAt
            },
            '*'
          );
        }
      } catch (err) {
        console.warn('[LiveWatch] Tick failed', err);
      }
    };

    tick();
    const id = setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isWatching, currentPlan.id, currentPlan.spatial?.origin?.lat, currentPlan.spatial?.origin?.lng]);

  // Handle preset selector changes
  const handleLoadPreset = (key: string) => {
    setSelectedPreset(key);
    setCurrentPlan(demoFixtures[key]);
    setLocationInput(demoFixtures[key].request.location);
    setActivityInput(demoFixtures[key].request.activity);
    setTimeInput(demoFixtures[key].request.time);
    setErrorMsg(null);
  };

  // Submit and query the live Agent Orchestrator endpoint
  const handleQueryAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locationInput.trim() || !activityInput.trim()) return;

    setIsLoading(true);
    setErrorMsg(null);

    try {
      console.log('[App] Posting query details to /api/plan ...');
      const response = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: locationInput,
          activity: activityInput,
          time: timeInput
        })
      });

      if (!response.ok) {
        const errPayload = await response.json();
        throw new Error(errPayload.error || 'Server returned an exception');
      }

      const planData: PlanResult = await response.json();
      setCurrentPlan(planData);
      setSelectedPreset(''); // reset active preset highlighted state
    } catch (err: any) {
      console.warn('[App] Live analysis failed. Activating contextual sandbox fallback.', err);
      setErrorMsg(
        err.message?.includes('GEMINI_API_KEY') 
          ? 'GEMINI_API_KEY is not configured in your Secrets panel. Falling back to simulated preset modes instantly.'
          : `Offline mode active: ${err.message || 'Unable to contact live agent endpoint.'}`
      );
      
      // Auto-fallback: try to find matching preset or default back to current state
      const matchingPresetKey = Object.keys(demoFixtures).find(
        key => locationInput.toLowerCase().includes(key.split('-')[0]) || activityInput.toLowerCase().includes(key.split('-')[0])
      );
      if (matchingPresetKey) {
        setCurrentPlan(demoFixtures[matchingPresetKey]);
        setSelectedPreset(matchingPresetKey);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const currentFlag = currentPlan.flag || 'white';

  const trendData = React.useMemo(() => {
    const peakF = currentPlan.wetBulbPeakF || 72;
    const timeStr = currentPlan.request.time || '12:00';
    
    let planHour = 14;
    if (timeStr) {
      const match = timeStr.match(/^(\d+)/);
      if (match) {
        planHour = parseInt(match[1], 10);
      }
    }

    const result = [];
    const peakHourOfDiurnalCycle = 15; // 3 PM
    
    for (let i = 0; i < 24; i++) {
      const currentHr = (planHour + i) % 24;
      const factor = Math.cos(((currentHr - peakHourOfDiurnalCycle) / 24) * 2 * Math.PI);
      
      const swingRange = peakF > 75 ? 10 : 6;
      const rawVal = peakF - (swingRange / 2) * (1 - factor);
      const wetBulbF = Math.round(rawVal);
      
      const ampm = currentHr >= 12 ? 'PM' : 'AM';
      const displayHour = currentHr % 12 === 0 ? 12 : currentHr % 12;
      const hourStr = `${displayHour.toString().padStart(2, '0')} ${ampm}`;
      
      let hourFlag: 'white' | 'green' | 'yellow' | 'red' | 'black' = 'white';
      if (wetBulbF >= 90) {
        hourFlag = 'black';
      } else if (wetBulbF >= 88) {
        hourFlag = 'red';
      } else if (wetBulbF >= 85) {
        hourFlag = 'yellow';
      } else if (wetBulbF >= 80) {
        hourFlag = 'green';
      } else {
        hourFlag = 'white';
      }

      result.push({
        hourStr,
        wetBulbF,
        flag: hourFlag,
        isPeak: currentHr === peakHourOfDiurnalCycle
      });
    }
    return result;
  }, [currentPlan.wetBulbPeakF, currentPlan.request.time]);
  
  // Custom theme mappings mapping USMC flag values to high-contrast brand color-pop dynamic options
  const flagMeta = {
    white: { 
      text: 'White Flag (Clear)', 
      color: 'bg-slate-100 text-slate-800 border-slate-300/80 outline-slate-200', 
      hex: '#9aa0a6', // Google Gray
      lightHex: '#f1f3f4',
      badgeText: 'text-slate-800',
      accentColor: 'border-slate-400 bg-slate-50/50',
      pulseDot: 'bg-slate-400',
      alertBg: 'bg-slate-50 border-slate-200 text-slate-700',
      textAccent: 'text-slate-600'
    },
    green: { 
      text: 'Green Flag (Low Warning)', 
      color: 'bg-[#e6f4ea] text-[#137333] border-[#a3cfbb] outline-emerald-300', 
      hex: '#34A853', // Google Green
      lightHex: '#e6f4ea',
      badgeText: 'text-emerald-700',
      accentColor: 'border-[#34A853] bg-[#e6f4ea]/40',
      pulseDot: 'bg-[#34A853]',
      alertBg: 'bg-[#e6f4ea]/30 border-[#a3cfbb] text-[#137333]',
      textAccent: 'text-emerald-700 font-bold'
    },
    yellow: { 
      text: 'Yellow Flag (Moderate Caution)', 
      color: 'bg-[#fef7e0] text-[#b06000] border-[#fde293] outline-amber-300', 
      hex: '#FBBC05', // Google Yellow
      lightHex: '#fef7e0',
      badgeText: 'text-amber-700',
      accentColor: 'border-[#FBBC05] bg-[#fef7e0]/40',
      pulseDot: 'bg-[#FBBC05]',
      alertBg: 'bg-[#fef7e0]/40 border-[#fde293] text-[#b06000]',
      textAccent: 'text-amber-700 font-extrabold'
    },
    red: { 
      text: 'Red Flag (Severe Hazard)', 
      color: 'bg-[#fce8e6] text-[#c5221f] border-[#f5c2c1] outline-rose-300', 
      hex: '#EA4335', // Google Red
      lightHex: '#fce8e6',
      badgeText: 'text-rose-700',
      accentColor: 'border-[#EA4335] bg-[#fce8e6]/40',
      pulseDot: 'bg-[#EA4335]',
      alertBg: 'bg-[#fce8e6]/45 border-[#f5c2c1] text-[#c5221f]',
      textAccent: 'text-rose-700 font-black'
    },
    black: { 
      text: 'Black Flag (Extreme Danger)', 
      color: 'bg-[#202124] text-white border-zinc-800 outline-zinc-700', 
      hex: '#202124', // Google Dark/Charcoal Black
      lightHex: '#f1f3f4',
      badgeText: 'text-stone-300',
      accentColor: 'border-[#202124] bg-zinc-900',
      pulseDot: 'bg-[#202124]',
      alertBg: 'bg-[#202124]/10 border-slate-300 text-slate-800',
      textAccent: 'text-[#202124] font-black'
    }
  }[currentFlag];

  return (
    <div className="min-h-screen flex flex-col bg-[#f1f5f9] font-sans text-slate-900 antialiased selection:bg-slate-900 selection:text-white pb-6">
      
      {/* Floating Bento Header & Controller Container */}
      <div className="max-w-7xl mx-auto w-full px-4 md:px-6 pt-6 space-y-5 shrink-0">
        
        {/* Balanced Header Block */}
        <header className="flex flex-col md:flex-row items-center justify-between px-6 md:px-8 py-4 bg-white border border-slate-200 rounded-2xl shadow-sm gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#202124] text-white rounded-xl flex items-center justify-center font-black text-base uppercase tracking-tighter shadow-md">HT</div>
            <div>
              <h1 className="text-lg font-black tracking-tight uppercase flex items-center gap-2 text-slate-900">
                Heat Threshold <span className="text-[#1a73e8] font-normal normal-case text-xs tracking-nowrap bg-[#e8f0fe] text-[#1a73e8] px-2.5 py-0.5 rounded-lg font-mono font-bold border border-[#aecbfa]">Gemini 3.5 Flash · Managed Agents</span>
              </h1>
              <p className="text-[10px] text-slate-500 font-bold tracking-wide uppercase">- Environmental Logistics Scheduler & Safety Guide -</p>
            </div>
          </div>

          {/* Live System Specs */}
          <div className="flex flex-wrap items-center gap-4 md:gap-6 text-xs shrink-0">
            <button
              onClick={() => setIsWatching(w => !w)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[10px] font-mono font-bold uppercase tracking-widest transition-all cursor-pointer ${
                isWatching
                  ? 'bg-[#34A853]/15 border-[#34A853]/55 text-[#137333] shadow-sm'
                  : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
              title={isWatching ? 'Live Watch ON — polls /api/watch/tick every 60s' : 'Enable Live Watch'}
            >
              {isWatching ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#34A853] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#34A853]"></span>
                  </span>
                  <Radio className="w-3.5 h-3.5" />
                  Live Watch
                </>
              ) : (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  Watch Paused
                </>
              )}
            </button>
            <div className="flex flex-col items-end">
              <span className="text-[9px] uppercase text-slate-400 font-bold tracking-widest font-mono">Managed Status</span>
              <div className="flex items-center gap-2 mt-0.5">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></div>
                <span className="text-xs font-mono font-semibold text-slate-700">
                  {currentPlan.agentTrace?.length || 9} Sub-Agents Active
                </span>
              </div>
              {lastTickAt && (
                <span className="text-[9px] font-mono text-slate-500 mt-0.5">
                  last tick {lastTickAt}{lastTickSource ? ` · ${lastTickSource}` : ''}
                </span>
              )}
            </div>
            <div className="hidden md:block h-8 w-[1px] bg-slate-200"></div>
            <div className="text-right">
              <p className="text-xs font-bold text-slate-800">{dateState}</p>
              <p className="text-[10px] text-zinc-500 font-mono uppercase bg-slate-100 px-1.5 py-0.5 rounded shadow-inner mt-0.5 tracking-tight font-semibold">{timeState}</p>
            </div>
          </div>
        </header>

        {/* Hero Preset Shortcuts bar, rounded and elegant */}
        <div className="bg-[#202124] border border-zinc-800 px-6 py-3.5 text-zinc-100 flex flex-col md:flex-row items-center justify-between gap-3 text-xs rounded-2xl shadow-md">
          <div className="flex items-center gap-2 text-zinc-400 font-mono text-[11px] font-semibold tracking-wide uppercase shrink-0">
            <Sparkles className="w-4 h-4 text-[#fbbc05] animate-pulse" /> Recommended Scenic Presets:
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            <button
              onClick={() => handleLoadPreset('sf-route')}
              className={`px-3.5 py-1.5 rounded-xl border text-[11px] font-mono tracking-tight transition-all font-bold cursor-pointer ${
                selectedPreset === 'sf-route'
                  ? 'bg-[#1a73e8] border-[#1a73e8] text-white shadow-md'
                  : 'bg-zinc-800/60 border-zinc-700 text-zinc-300 hover:bg-zinc-850 hover:text-white'
              }`}
            >
              🚵‍♂️ SF SCENIC ROUTE (GO)
            </button>
            <button
              onClick={() => handleLoadPreset('zilker-bike')}
              className={`px-3.5 py-1.5 rounded-xl border text-[11px] font-mono tracking-tight transition-all font-bold cursor-pointer ${
                selectedPreset === 'zilker-bike'
                  ? 'bg-[#1a73e8] border-[#1a73e8] text-white shadow-md'
                  : 'bg-zinc-800/60 border-zinc-700 text-zinc-300 hover:bg-zinc-850 hover:text-white'
              }`}
            >
              🔥 ZILKER AUSTIN (DELAY)
            </button>
            <button
              onClick={() => handleLoadPreset('hyde-park')}
              className={`px-3.5 py-1.5 rounded-xl border text-[11px] font-mono tracking-tight transition-all font-bold cursor-pointer ${
                selectedPreset === 'hyde-park'
                  ? 'bg-[#1a73e8] border-[#1a73e8] text-white shadow-md'
                  : 'bg-zinc-800/60 border-zinc-700 text-zinc-300 hover:bg-zinc-850 hover:text-white'
              }`}
            >
              🏃‍♂️ HYDE LONDON (CLEAR RUN)
            </button>
          </div>
        </div>

      </div>

      {/* Main Content Area */}
      <main className="flex-1 p-4 md:p-6 space-y-5 max-w-7xl mx-auto w-full">
        
        {/* Dynamic Warning Message if offline fallback triggered */}
        {errorMsg && (
          <div className="bg-[#fef7e0] border border-[#fde293] rounded-2xl p-4 flex items-start gap-3 shadow-sm">
            <AlertTriangle className="w-5 h-5 text-[#b06000] shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-[#b06000]">Operational Notice</p>
              <p className="text-xs text-[#b06000]/90 mt-0.5">{errorMsg}</p>
            </div>
          </div>
        )}

        {/* McpReplay banner: shown when ?replay=<id> hydrated the dashboard */}
        {replayBanner && (
          <div className="bg-[#e8f0fe] border border-[#aecbfa] rounded-2xl p-4 flex items-start gap-3 shadow-sm">
            <Radio className="w-5 h-5 text-[#1a73e8] shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-bold text-[#1a73e8] uppercase tracking-wider font-mono">McpReplay Active</p>
              <p className="text-xs text-[#1557b0] mt-0.5 font-medium">{replayBanner}</p>
            </div>
            {currentPlan.id && (
              <a
                href={`/trace/${currentPlan.id}`}
                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-50 text-[#1a73e8] text-[10px] font-bold rounded-lg border border-[#aecbfa] uppercase tracking-tight font-mono"
              >
                <ExternalLink className="w-3 h-3" /> View Span Tree
              </a>
            )}
          </div>
        )}

        {/* Input Fields Card Row */}
        <section className="bg-white rounded-2xl border border-slate-200 p-5 md:p-6 shadow-sm">
          <h2 className="text-xs font-bold uppercase tracking-widest text-[#202124]/50 mb-4 flex items-center gap-1.5 font-mono">
            <Search className="w-4 h-4 text-[#1a73e8]" /> Specify Your Target Excursion parameters
          </h2>
          <form onSubmit={handleQueryAgent} className="grid grid-cols-1 md:grid-cols-4 gap-5 items-end">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-slate-400" /> Target Location
              </label>
              <input
                type="text"
                value={locationInput}
                onChange={(e) => setLocationInput(e.target.value)}
                placeholder="Where are you planning to go?"
                className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/15 focus:border-[#1a73e8] bg-slate-50 font-semibold"
                required
              />
            </div>
            
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono flex items-center gap-1">
                <Activity className="w-3.5 h-3.5 text-slate-400" /> Intended Activity
              </label>
              <input
                type="text"
                value={activityInput}
                onChange={(e) => setActivityInput(e.target.value)}
                placeholder="e.g. Cycling, jogging, walking"
                className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/15 focus:border-[#1a73e8] bg-slate-50 font-semibold"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-400" /> Target Start Time
              </label>
              <input
                type="text"
                value={timeInput}
                onChange={(e) => setTimeInput(e.target.value)}
                placeholder="e.g. 14:30 or 2:30 PM"
                className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/15 focus:border-[#1a73e8] bg-slate-50 font-mono font-semibold"
              />
            </div>

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl font-bold uppercase tracking-widest text-xs transition-all shadow-md active:translate-y-[1px] disabled:bg-slate-350 disabled:shadow-none flex items-center justify-center gap-2 cursor-pointer border border-[#1a73e8]"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Synthesizing Graph...
                  </>
                ) : (
                  <>
                    <Cpu className="w-4 h-4" /> Synthesize Grid Plan <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>
        </section>

        {/* Bento Grid Layout - Beautifully balanced with dynamic color accents emphasizing safety alerts */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 md:grid-rows-6 auto-rows-min md:h-[840px] items-stretch">
          
          {/* Primary Verdict Card with dynamic color accent as a high-contrast top-border */}
          <section 
            className="col-span-1 md:col-span-4 md:row-span-4 bg-[#202124] rounded-2xl shadow-xl overflow-hidden flex flex-col hover:shadow-2xl transition-all duration-300 group border-t-6"
            style={{ borderColor: flagMeta?.hex || '#202124' }}
          >
            <div className="p-5 bg-[#1a1b1d] border-b border-zinc-850 flex justify-between items-center shrink-0">
              <h2 className="text-white text-xs font-bold uppercase tracking-widest flex items-center gap-1.5 font-mono">
                <Cpu className="text-[#1a73e8] w-4 h-4" /> Primary Agent Verdict
              </h2>
              <span className="px-2.5 py-0.5 bg-white/10 rounded-lg text-[9px] text-[#aecbfa] font-mono tracking-tighter shrink-0 select-none font-bold">
                PRO-LVL-GPS
              </span>
            </div>
            <div className="flex-1 p-6 flex flex-col justify-center items-center text-center">
              <div className={`mb-4 px-6 py-2.5 rounded-full border-2 ${
                currentPlan.verdict === 'go' 
                  ? 'bg-[#34A853]/15 border-[#34A853]/55 text-[#34A853]' 
                  : currentPlan.verdict === 'delay' 
                    ? 'bg-[#EA4335]/15 border-[#EA4335]/55 text-[#EA4335]' 
                    : 'bg-[#FBBC05]/15 border-[#FBBC05]/55 text-[#FBBC05]'
              } shadow-md`}>
                <span className="text-3xl md:text-4xl font-black uppercase tracking-tighter italic block">
                  {currentPlan.verdict === 'go' ? 'GO NOW' : currentPlan.verdict === 'delay' ? 'DELAY SCHEDULE' : 'CONSIDER ALTERNATE'}
                </span>
              </div>
              <h3 className="text-white text-xl md:text-2xl font-black mb-3 px-2 leading-tight tracking-tight">
                {currentPlan.headline}
              </h3>
              <p className="text-zinc-400 text-xs md:text-sm leading-relaxed px-2 font-medium max-w-sm">
                {currentPlan.reasoning}
              </p>
            </div>
            
            <div className="p-5 bg-[#1a1b1d] mt-auto border-t border-zinc-850">
              <div className="flex justify-between items-center text-[10px] text-zinc-505 uppercase font-bold tracking-widest font-mono">
                <span className="text-zinc-400">Suggested Departure</span>
                <span className="text-white tracking-widest bg-zinc-900 px-2.5 py-1 rounded-lg border border-zinc-800 font-bold text-xs text-right select-all">
                  {currentPlan.verdict === 'go' ? currentPlan.departBy ? new Date(currentPlan.departBy).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : currentPlan.request.time || '14:30' : 'Hold Pattern'}
                </span>
              </div>
              <div className="w-full bg-[#202124] h-1.5 mt-3.5 rounded-full overflow-hidden shadow-inner">
                <div className={`h-full transition-all duration-1000 ${
                  currentPlan.verdict === 'go' ? 'bg-[#34A853] w-[95%]' : currentPlan.verdict === 'delay' ? 'bg-[#EA4335] w-[15%]' : 'bg-[#FBBC05] w-[55%]'
                }`}></div>
              </div>
            </div>
          </section>

          {/* Environment & Heat Profile Card with a custom safety color stripe accent */}
          <section 
            className="col-span-1 md:col-span-3 md:row-span-2 bg-white rounded-2xl border border-slate-200 p-6 flex flex-col justify-between hover:border-slate-300 hover:shadow-md transition-all duration-300 relative overflow-hidden shadow-sm"
            style={{ borderLeft: `6px solid ${flagMeta?.hex || '#cbd5e1'}` }}
          >
            <div className="flex justify-between items-start shrink-0">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#202124]/40 font-mono">Environmental Flag</h2>
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-md border font-mono select-none tracking-tight ${flagMeta?.color}`}>
                {flagMeta?.text}
              </span>
            </div>
            <div className="my-3 flex items-end justify-between">
              <div className="flex items-baseline gap-2">
                <span className={`text-4xl md:text-5xl font-black tracking-tighter uppercase ${flagMeta?.textAccent || 'text-slate-855'}`}>
                  {currentFlag}
                </span>
                <div 
                  className={`w-4 h-4 rounded-full border border-slate-200 animate-pulse shrink-0 ${flagMeta?.pulseDot || 'bg-slate-300'}`} 
                />
              </div>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed font-semibold">
              Assigned strictly based on the USMC training directives mapped to the maximum peak thermal parameters.
            </p>
          </section>

          {/* Peak Wet Bulb Card with Indigo indicator stripe accent */}
          <section 
            className="col-span-1 md:col-span-2 md:row-span-2 bg-white rounded-2xl border border-slate-200 p-5 flex flex-col justify-between hover:border-slate-300 hover:shadow-md transition-all duration-300 shadow-sm"
            style={{ borderLeft: '6px solid #1a73e8' }}
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#202124]/40 font-mono">Wet Bulb Trend (24h)</h2>
              {hoveredHourIndex !== null ? (
                <span className="text-[9px] font-mono font-bold text-[#1a73e8] bg-[#e8f0fe] px-1.5 py-0.5 rounded border border-[#aecbfa]">
                  {trendData[hoveredHourIndex].hourStr}
                </span>
              ) : (
                <span className="text-[9px] font-mono font-bold text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                  Peak: {currentPlan.wetBulbPeakF}°F
                </span>
              )}
            </div>

            <div className="flex justify-between items-baseline my-1">
              <div className="flex items-baseline gap-1">
                <span className="text-4xl md:text-5xl font-black text-[#1a73e8] tracking-tighter">
                  {hoveredHourIndex !== null ? trendData[hoveredHourIndex].wetBulbF : currentPlan.wetBulbPeakF}°
                </span>
                <span className="text-xl font-bold text-slate-400 font-mono">F</span>
              </div>
              <div className="text-right">
                {hoveredHourIndex !== null ? (
                  <span className={`text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded border font-mono select-none ${
                    trendData[hoveredHourIndex].flag === 'white' ? 'bg-slate-50 text-slate-700 border-slate-200' :
                    trendData[hoveredHourIndex].flag === 'green' ? 'bg-[#e6f4ea] text-[#137333] border-[#a3cfbb]' :
                    trendData[hoveredHourIndex].flag === 'yellow' ? 'bg-[#fef7e0] text-[#b06000] border-[#fde293]' :
                    trendData[hoveredHourIndex].flag === 'red' ? 'bg-[#fce8e6] text-[#c5221f] border-[#fad2cf]' :
                    'bg-zinc-900 text-white border-zinc-800'
                  }`}>
                    {trendData[hoveredHourIndex].flag} Flag
                  </span>
                ) : (
                  <span className={`text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded border font-mono select-none ${
                    currentFlag === 'white' ? 'bg-slate-50 text-slate-700 border-slate-200' :
                    currentFlag === 'green' ? 'bg-[#e6f4ea] text-[#137333] border-[#a3cfbb]' :
                    currentFlag === 'yellow' ? 'bg-[#fef7e0] text-[#b06000] border-[#fde293]' :
                    currentFlag === 'red' ? 'bg-[#fce8e6] text-[#c5221f] border-[#fad2cf]' :
                    'bg-zinc-900 text-white border-zinc-800'
                  }`}>
                    {currentFlag} Peak
                  </span>
                )}
              </div>
            </div>

            {/* Sparkline Visualization Container */}
            <div className="relative h-[65px] w-full bg-slate-50/50 rounded-xl border border-slate-100 p-1.5 mt-1 overflow-hidden flex flex-col justify-end select-none">
              {(() => {
                const minTemp = Math.min(...trendData.map(d => d.wetBulbF));
                const maxTemp = Math.max(...trendData.map(d => d.wetBulbF));
                const tempDiff = maxTemp - minTemp || 1;
                const points = trendData.map((d, i) => ({
                  x: 5 + i * 10,
                  y: 46 - ((d.wetBulbF - minTemp) / tempDiff) * 40
                }));
                const linePath = points.reduce((acc, p, i) => i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`, '');
                const areaPath = linePath ? `${linePath} L 235 52 L 5 52 Z` : '';

                return (
                  <svg 
                    className="w-full h-full overflow-visible" 
                    viewBox="0 0 240 52" 
                    preserveAspectRatio="none"
                  >
                    <defs>
                      <linearGradient id="sparkline-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#1a73e8" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#1a73e8" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>
                    
                    {/* Horizontal reference line matching flag risk changes if appropriate */}
                    <line 
                      x1="0" 
                      y1={46 - ((80 - minTemp) / tempDiff) * 40} 
                      x2="240" 
                      y2={46 - ((80 - minTemp) / tempDiff) * 40}
                      stroke="#dadce0" 
                      strokeDasharray="2,3" 
                      strokeWidth="0.75" 
                      opacity={maxTemp >= 80 && minTemp <= 80 ? 0.7 : 0}
                    />

                    {/* Gradient filled area */}
                    {areaPath && (
                      <path 
                        d={areaPath} 
                        fill="url(#sparkline-grad)" 
                      />
                    )}

                    {/* Connection Stroke Line */}
                    {linePath && (
                      <path 
                        d={linePath} 
                        fill="none" 
                        stroke="#1a73e8" 
                        strokeWidth="2" 
                        strokeLinecap="round" 
                        strokeLinejoin="round" 
                      />
                    )}

                    {/* Static Marker Dot corresponding to peak hour if not active user hover */}
                    {hoveredHourIndex === null && trendData.map((d, i) => {
                      if (d.wetBulbF === currentPlan.wetBulbPeakF) {
                        const p = points[i];
                        return (
                          <g key={i}>
                            <circle 
                              cx={p.x} 
                              cy={p.y} 
                              r="4" 
                              fill="#1a73e8" 
                              stroke="#ffffff" 
                              strokeWidth="1.5" 
                              className="shadow-sm"
                            />
                            <circle 
                              cx={p.x} 
                              cy={p.y} 
                              r="7" 
                              fill="none" 
                              stroke="#1a73e8" 
                              strokeWidth="1" 
                              opacity="0.5"
                              className="animate-pulse"
                            />
                          </g>
                        );
                      }
                      return null;
                    })}

                    {/* Floating Hover Elements */}
                    {hoveredHourIndex !== null && points[hoveredHourIndex] && (
                      <g>
                        <line 
                          x1={points[hoveredHourIndex].x} 
                          y1="0" 
                          x2={points[hoveredHourIndex].x} 
                          y2="52" 
                          stroke="#1a73e8" 
                          strokeWidth="1" 
                          strokeDasharray="1,2" 
                        />
                        <circle 
                          cx={points[hoveredHourIndex].x} 
                          cy={points[hoveredHourIndex].y} 
                          r="4.5" 
                          fill={
                            trendData[hoveredHourIndex].flag === 'white' ? '#9aa0a6' :
                            trendData[hoveredHourIndex].flag === 'green' ? '#34a853' :
                            trendData[hoveredHourIndex].flag === 'yellow' ? '#fbbc05' :
                            trendData[hoveredHourIndex].flag === 'red' ? '#ea4335' :
                            '#202124'
                          } 
                          stroke="#ffffff" 
                          strokeWidth="1.5" 
                          className="drop-shadow-sm transition-all duration-100"
                        />
                      </g>
                    )}

                    {/* Transparent high-width vertical slices for optimal UX cursor tracking */}
                    {points.map((p, i) => (
                      <rect
                        key={i}
                        x={p.x - 5}
                        y="0"
                        width="10"
                        height="52"
                        fill="transparent"
                        className="cursor-crosshair"
                        onMouseEnter={() => setHoveredHourIndex(i)}
                        onMouseMove={() => setHoveredHourIndex(i)}
                        onMouseLeave={() => setHoveredHourIndex(null)}
                      />
                    ))}
                  </svg>
                );
              })()}
            </div>

            <div className="flex justify-between items-center mt-2.5 text-[8px] font-mono font-bold text-slate-400 select-none">
              <span>{trendData[0] ? trendData[0].hourStr : 'Start'}</span>
              <span className="text-[10px] text-slate-500 font-extrabold">24h Prediction Span</span>
              <span>{trendData[23] ? trendData[23].hourStr : 'End'}</span>
            </div>
          </section>

          {/* Map Embed Card */}
          <section className="col-span-1 md:col-span-3 md:row-span-4 bg-white rounded-2xl border border-slate-200 p-4 flex flex-col justify-between hover:border-slate-300 hover:shadow-md transition-all duration-300 relative overflow-hidden shadow-sm">
            <div className="flex-1 min-h-[220px]">
              <MapEmbed 
                spatial={currentPlan.spatial} 
                coolingStops={currentPlan.coolingStops} 
              />
            </div>
          </section>

          {/* Recommended Cooling Stops Card */}
          <section className="col-span-1 md:col-span-5 md:row-span-2 bg-white rounded-2xl border border-slate-200 p-6 hover:border-slate-300 hover:shadow-md transition-all duration-300 flex flex-col justify-between shadow-sm">
            <div className="flex flex-col h-full justify-between">
              <div>
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#202124]/40 font-mono mb-3 block">
                  💡 Recommended Hydration / Cooling Stops
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto pr-1 max-h-[110px]">
                  {currentPlan.coolingStops && currentPlan.coolingStops.length > 0 ? (
                    currentPlan.coolingStops.slice(0, 3).map((stop, index) => (
                      <div 
                        key={stop.placeId} 
                        className={`flex gap-3 items-start p-2.5 rounded-xl border transition-all ${flagMeta?.alertBg || 'bg-slate-50 border-slate-150'}`}
                      >
                        <div 
                          className="w-7 h-7 rounded bg-white flex-shrink-0 flex items-center justify-center font-black text-[10px] border shadow-xs"
                          style={{ borderColor: flagMeta?.hex || '#dadce0', color: flagMeta?.hex || '#1a73e8' }}
                        >
                          0{index + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-bold text-slate-800 truncate">{stop.name}</p>
                            {stop.mapsUri && (
                              <a
                                href={stop.mapsUri}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 text-[9px] font-bold text-[#1a73e8] hover:underline uppercase tracking-tight shrink-0"
                              >
                                <span>Navigate</span>
                                <ExternalLink className="w-2 h-2" />
                              </a>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-500 leading-snug font-semibold line-clamp-2 mt-0.5">{stop.why}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="col-span-2 text-center text-xs text-slate-400 py-4 font-medium">
                      No explicit cooling/hydration stops requested or available.
                    </div>
                  )}
                </div>
              </div>

              {/* Grounded Live Google Maps references block */}
              {(((currentPlan as any).groundingChunks && (currentPlan as any).groundingChunks.length > 0) || currentPlan.coolingStops?.some(s => s.placeId.startsWith('gmp-'))) && (
                <div className="mt-3 pt-3 border-t border-slate-100 shrink-0">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-[#202124]/40 font-mono mb-1.5 flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#1a73e8] animate-pulse"></span>
                    Grounded Live Maps References:
                  </p>
                  <div className="flex flex-wrap gap-1.5 max-h-[50px] overflow-y-auto">
                    {((currentPlan as any).groundingChunks && (currentPlan as any).groundingChunks.length > 0) ? (
                      (currentPlan as any).groundingChunks.map((chunk: any, i: number) => {
                        const title = chunk.maps?.title || chunk.web?.title || 'Google Maps Location';
                        const uri = chunk.maps?.uri || chunk.web?.uri;
                        if (!uri) return null;
                        return (
                          <a
                            key={i}
                            href={uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#e8f0fe] hover:bg-[#d2e3fc] text-[#1a73e8] text-[9px] font-bold rounded-lg border border-[#aecbfa] transition-colors uppercase tracking-tight font-mono"
                          >
                            <MapPin className="w-2.5 h-2.5 text-[#1a73e8] shrink-0" />
                            <span className="truncate max-w-[120px]">{title}</span>
                            <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                          </a>
                        );
                      })
                    ) : (
                      // Dynamic link generation for cooling stops if grounding metadata array is empty but we have real items
                      currentPlan.coolingStops.map((stop, i) => (
                        <a
                          key={stop.placeId}
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.name)}&query_place_id=${stop.placeId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#e8f0fe] hover:bg-[#d2e3fc] text-[#1a73e8] text-[9px] font-bold rounded-lg border border-[#aecbfa] transition-colors uppercase tracking-tight font-mono"
                        >
                          <MapPin className="w-2.5 h-2.5 text-[#1a73e8] shrink-0" />
                          <span className="truncate max-w-[120px]">{stop.name}</span>
                          <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                        </a>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Agent Activity Logs/Trace */}
          <section className="col-span-1 md:col-span-9 md:row-span-2 bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col hover:border-slate-300 hover:shadow-md transition-all duration-300 shadow-sm">
            <div className="px-6 py-3 border-b border-slate-150 flex justify-between items-center bg-slate-50/70 shrink-0">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#202124]/40 font-mono flex items-center gap-1">
                🕵️‍♂️ Agent Activity Trace Logs
              </h2>
              <div className="flex gap-2 items-center">
                {currentPlan.id && (
                  <a
                    href={`/trace/${currentPlan.id}`}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-md text-[9px] uppercase font-bold tracking-wider font-mono border border-slate-200"
                  >
                    <ExternalLink className="w-2.5 h-2.5" /> Open Span Tree · {currentPlan.id.slice(0, 8)}
                  </a>
                )}
                <div className="px-2.5 py-0.5 bg-[#e8f0fe] text-[#1a73e8] rounded-md text-[9px] uppercase font-bold tracking-wider font-mono border border-[#aecbfa]">
                  Live Feed Connected
                </div>
              </div>
            </div>
            <div className="flex-1 p-4 font-mono text-[10px] text-slate-650 overflow-y-auto space-y-1.5 bg-slate-50 select-all">
              {currentPlan.agentTrace && currentPlan.agentTrace.map((trace, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-[#1a73e8] font-bold shrink-0">[{trace.agentName}]</span>
                  <span className="text-slate-400 font-mono shrink-0">duration {trace.durationMs}ms:</span>
                  <span className="text-slate-700 font-medium leading-relaxed">{trace.outputSummary || 'Completed calculation loop.'}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Final Actions / XR Interactive Visualizer Card - Slate Styled to maintain beautiful monochromatic layout */}
          <section className="col-span-1 md:col-span-3 md:row-span-2 bg-[#202124] border border-zinc-800 rounded-2xl p-6 flex flex-col justify-between text-white hover:bg-black transition-all duration-300 shadow-xl">
            <div className="space-y-1">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 font-mono">AR/XR Spatial Telemetry</h2>
              <p className="text-xs text-zinc-300 font-medium leading-relaxed">
                Step directly into the environmental scheduling coordinates inside spatial reality. Works with mobile sensors.
              </p>
            </div>
            
            <button 
              onClick={() => setIsXrModalOpen(true)}
              className="w-full py-2.5 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl font-bold uppercase tracking-widest text-xs transition-colors shadow-lg flex items-center justify-center gap-1.5 active:translate-y-[1px] cursor-pointer border border-[#1a73e8]"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Launch spatial xr 3D
            </button>
          </section>

        </div>

        {/* Citations list block */}
        {currentPlan.envNotes && currentPlan.envNotes.length > 0 && (
          <section className="bg-slate-50 border border-slate-200 rounded-2xl p-5 shadow-sm space-y-2">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono flex items-center gap-1.5">
              <Info className="w-4 h-4 text-slate-500" /> Scientific environmental parameters & citing specifications
            </h3>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-1 text-[11px] font-semibold text-slate-600 font-mono leading-relaxed">
              {currentPlan.envNotes.map((note, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-slate-400 font-bold">▪</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

      </main>

      {/* Floating Contained Footer with Bento Alignment */}
      <div className="max-w-7xl mx-auto w-full px-4 md:px-6 pb-6 mt-1 shrink-0">
        <footer className="px-6 py-4 bg-white border border-slate-200 rounded-2xl flex flex-col md:flex-row justify-between items-center gap-3 shadow-sm">
          <p className="text-[10px] text-slate-450 font-bold uppercase tracking-wider text-center md:text-left">
            Heat Threshold is an environmental safety scheduling tool, not medical advice. Consult a healthcare professional for health concerns.
          </p>
          <div className="flex gap-4 text-[10px] text-slate-450 font-mono font-bold tracking-wider select-none shrink-0 border-l border-slate-200 pl-4">
            <span>STULL (2011) METHODOLOGY</span>
            <span>•</span>
            <span>GEMINI 3.5 FLASH</span>
          </div>
        </footer>
      </div>

      {/* Spatial XR 3D Immersive Simulation Modal */}
      {isXrModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-5xl w-full p-6 text-white shadow-2xl relative">
            <h2 className="text-lg font-black tracking-tight uppercase flex items-center gap-2 text-blue-400 mb-1">
              🚀 Spatial XR Environmental Timeline HUD
            </h2>
            <p className="text-[10px] font-mono tracking-wide text-indigo-300 uppercase mb-4 border-b border-slate-850 pb-2">
              Waypoint projections & safety indices mapped in 3D relative to: {currentPlan.spatial.origin.label}
            </p>

            {/* Real 3D WebXR and Simulator Experience */}
            <iframe
              ref={xrIframeRef}
              src={`/xr.html?verdict=${encodeURIComponent(currentPlan.verdict)}&headline=${encodeURIComponent(currentPlan.headline)}&reasoning=${encodeURIComponent(currentPlan.reasoning)}&wetBulb=${currentPlan.wetBulbPeakF}&flag=${currentPlan.flag}&spatial=${encodeURIComponent(JSON.stringify(currentPlan.spatial))}&stops=${encodeURIComponent(JSON.stringify(currentPlan.coolingStops))}&breaks=${encodeURIComponent(JSON.stringify(currentPlan.suggestedBreaks || []))}&watch=${isWatching ? '1' : '0'}&gmpKey=${encodeURIComponent(process.env.GOOGLE_MAPS_PLATFORM_KEY || '')}`}
              className="w-full h-96 md:h-[500px] border border-slate-800 rounded-xl bg-slate-950 mb-4 shadow-inner"
              title="Spatial XR Immersive Timeline HUD"
              allow="camera; microphone; geolocation"
            />

            {/* Quick specifications / Close button */}
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between border-t border-slate-800 pt-4">
              <p className="text-[10px] text-slate-400 max-w-xl text-center sm:text-left leading-relaxed">
                *WebXR immersive headset calibration active. Move or rotate the 3D map by dragging. Interact with waypoints in 3D to trigger contextual safety readouts.
              </p>
              <button
                onClick={() => setIsXrModalOpen(false)}
                className="px-5 py-2 bg-blue-600 font-bold uppercase tracking-wider text-xs rounded-xl hover:bg-blue-500 transition-colors w-full sm:w-auto shrink-0 select-none cursor-pointer"
              >
                Close HUD Experience
              </button>
            </div>
            
          </div>
        </div>
      )}

    </div>
  );
}
