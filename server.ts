import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { runOrchestrationGraph, runWatchTick } from './src/lib/agents/orchestrator';
import { getHourlyForecasts } from './src/lib/weatherService';
import { demoFixtures } from './src/lib/demoFixtures';
import { PlanResult } from './src/lib/types';
import { loadRecording } from './src/lib/observability/mcpreplay';
import { listRecordings } from './src/lib/observability/mcptape';
import dotenv from 'dotenv';

// Load environmental variables safely
dotenv.config();

const PORT = 3000;

async function startServer() {
  const app = express();
  app.use(express.json());

  // Logging Middleware
  app.use((req, res, next) => {
    console.log(`[Server] ${req.method} ${req.url}`);
    next();
  });

  // 1. API: Weather Route
  app.get('/api/weather', async (req, res) => {
    try {
      const lat = parseFloat(req.query.lat as string);
      const lng = parseFloat(req.query.lng as string);

      if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ error: 'Missing or invalid lat/lng parameters' });
      }

      const forecasts = await getHourlyForecasts(lat, lng);
      res.json(forecasts);
    } catch (err: any) {
      console.error('[Server Error] /api/weather error:', err);
      res.status(500).json({ error: err.message || 'Severe weather retrieval exception' });
    }
  });

  // 2. API: Plan Generation Route (Parallel Sub-Agents Engine)
  app.post('/api/plan', async (req, res) => {
    res.setHeader('x-threshold-source', 'live-agent');
    try {
      const { location, activity, time, demo } = req.body;

      // Check for ?demo= true OR explicitly passed demo ID or header
      const demoId = (req.query.demo as string) || demo;

      if (demoId && demoFixtures[demoId]) {
        console.log(`[Server] Demo safety net ENGAGED. Serving fixture: ${demoId}`);
        res.setHeader('x-threshold-source', 'fixture');
        return res.json(demoFixtures[demoId]);
      }

      if (!location || !activity) {
        return res.status(400).json({ error: 'Location and activity strings are required' });
      }

      const planningTime = time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      console.log(`[Server] Deploying Managed Agent flow for: "${location}" | "${activity}" | "${planningTime}"`);
      const plan = await runOrchestrationGraph(location, activity, planningTime);
      res.json(plan);
    } catch (err: any) {
      console.error('[Server Error] /api/plan error:', err);
      res.status(550).json({
        error: err.message || 'Critical model computation failure',
        traceback: 'Agent compilation error. Standard fallback recommended.'
      });
    }
  });

  // 3. API: Plan GET handler supporting direct URL presets e.g. /api/plan?demo=sf-route
  app.get('/api/plan', (req, res) => {
    const demoId = req.query.demo as string;
    if (demoId && demoFixtures[demoId]) {
      res.setHeader('x-threshold-source', 'fixture');
      return res.json(demoFixtures[demoId]);
    }
    return res.status(400).json({ error: 'GET requests only allowed for demo queries.' });
  });

  // 4. API: Live Watch tick — single-shot re-evaluation of weather/flag/verdict
  // for an already-resolved plan. The client polls this on an interval to
  // power "live watch mode" without re-paying the geocoding + grounding cost.
  app.post('/api/watch/tick', async (req, res) => {
    const prev: PlanResult | undefined = req.body?.plan;
    if (!prev || !prev.spatial?.origin) {
      return res.status(400).json({ error: 'Watch tick requires { plan } with spatial.origin.' });
    }
    try {
      const tick = await runWatchTick(prev);
      res.json(tick);
    } catch (err: any) {
      console.error('[Watch] Tick failed:', err);
      res.status(500).json({ error: err.message || 'Watch tick failed' });
    }
  });

  // 5. McpReplay: deterministic playback of a recorded managed-agents run.
  // The demo safety net — same code path, cached LLM responses.
  app.get('/api/replay/:runId', async (req, res) => {
    const { runId } = req.params;
    const recording = await loadRecording(runId);
    if (!recording) {
      return res.status(404).json({ error: `No McpTape recording found for runId: ${runId}` });
    }
    res.setHeader('x-threshold-source', 'mcp-replay');
    res.json({ ...recording.result, replayedFrom: recording.runId });
  });

  // 6. PlatAtlas: span tree viewer endpoint for /trace/:runId page.
  app.get('/api/trace/:runId', async (req, res) => {
    const { runId } = req.params;
    const recording = await loadRecording(runId);
    if (!recording) {
      return res.status(404).json({ error: `No PlatAtlas trace found for runId: ${runId}` });
    }
    res.json({
      runId: recording.runId,
      recordedAt: recording.recordedAt,
      request: recording.request,
      spans: recording.spans,
      result: recording.result
    });
  });

  // 7. McpTape: list available recordings (for the trace index).
  app.get('/api/runs', async (_req, res) => {
    const runs = await listRecordings();
    res.json({ runs });
  });

  // 4. Vite Dev Integration or Standalone Production Servicing
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
    console.log('[Server] Vite middleware integrated.');
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log('[Server] Serving production static bundle.');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Heat Threshold running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('[Server] Critical start-up error:', error);
});
