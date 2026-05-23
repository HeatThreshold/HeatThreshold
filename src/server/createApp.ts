import express from 'express';
import { runOrchestrationGraph, runWatchTick } from '../lib/agents/orchestrator';
import { getHourlyForecasts } from '../lib/weatherService';
import { demoFixtures } from '../lib/demoFixtures';
import { PlanResult } from '../lib/types';
import { loadRecording } from '../lib/observability/mcpreplay';
import { listRecordings } from '../lib/observability/mcptape';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.use((req, _res, next) => {
    console.log(`[Server] ${req.method} ${req.url}`);
    next();
  });

  // Health probe — touches none of the orchestrator imports so it's a clean
  // signal of "function loads + serves traffic." If /api/health is 200 but
  // /api/plan or /api/watch/tick are 500, the bug is in the request handler,
  // not in module loading.
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      now: new Date().toISOString(),
      node: process.version,
      uptime: process.uptime(),
      env: {
        hasGeminiKey: !!process.env.GEMINI_API_KEY,
        hasGoogleMapsKey: !!process.env.GOOGLE_MAPS_PLATFORM_KEY,
        hasBlobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
        vercel: !!process.env.VERCEL
      }
    });
  });

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

  app.post('/api/plan', async (req, res) => {
    res.setHeader('x-threshold-source', 'live-agent');
    try {
      const { location, activity, time, demo } = req.body;

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
      res.status(500).json({
        error: err?.message || String(err) || 'Critical model computation failure',
        name: err?.name,
        stack: err?.stack?.split('\n').slice(0, 8).join('\n'),
        traceback: 'Agent compilation error. Standard fallback recommended.'
      });
    }
  });

  app.get('/api/plan', (req, res) => {
    const demoId = req.query.demo as string;
    if (demoId && demoFixtures[demoId]) {
      res.setHeader('x-threshold-source', 'fixture');
      return res.json(demoFixtures[demoId]);
    }
    return res.status(400).json({ error: 'GET requests only allowed for demo queries.' });
  });

  app.post('/api/watch/tick', async (req, res) => {
    const prev: PlanResult | undefined = req.body?.plan;
    if (!prev || !prev.spatial?.origin) {
      return res.status(400).json({ error: 'Watch tick requires { plan } with spatial.origin.' });
    }
    if (typeof prev.spatial.origin.lat !== 'number' || typeof prev.spatial.origin.lng !== 'number') {
      return res.status(400).json({
        error: `Invalid spatial.origin coords: lat=${prev.spatial.origin.lat} lng=${prev.spatial.origin.lng}`
      });
    }
    try {
      const tick = await runWatchTick(prev);
      res.json(tick);
    } catch (err: any) {
      console.error('[Watch] Tick failed:', err);
      // Surface the actual error message + stack to the client so the next
      // failure shows up in the browser console instead of "tick 500".
      res.status(500).json({
        error: err?.message || String(err) || 'Watch tick failed',
        name: err?.name,
        stack: err?.stack?.split('\n').slice(0, 5).join('\n')
      });
    }
  });

  app.get('/api/replay/:runId', async (req, res) => {
    const { runId } = req.params;
    const recording = await loadRecording(runId);
    if (!recording) {
      return res.status(404).json({ error: `No McpTape recording found for runId: ${runId}` });
    }
    res.setHeader('x-threshold-source', 'mcp-replay');
    res.json({ ...recording.result, replayedFrom: recording.runId });
  });

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

  app.get('/api/runs', async (_req, res) => {
    const runs = await listRecordings();
    res.json({ runs });
  });

  return app;
}
