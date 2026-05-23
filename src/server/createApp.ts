import express from 'express';
import { runOrchestrationGraph, runWatchTick } from '../lib/agents/orchestrator';
import { getHourlyForecasts } from '../lib/weatherService';
import { demoFixtures } from '../lib/demoFixtures';
import { PlanResult } from '../lib/types';
import { loadRecording } from '../lib/observability/mcpreplay';
import { listRecordings } from '../lib/observability/mcptape';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    console.log(`[Server] ${req.method} ${req.url}`);
    next();
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
      res.status(550).json({
        error: err.message || 'Critical model computation failure',
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
    try {
      const tick = await runWatchTick(prev);
      res.json(tick);
    } catch (err: any) {
      console.error('[Watch] Tick failed:', err);
      res.status(500).json({ error: err.message || 'Watch tick failed' });
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
