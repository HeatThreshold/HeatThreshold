import type { IncomingMessage, ServerResponse } from 'http';
// Note the relative path: this file lives in api-src/, the createApp source
// lives in src/server/. esbuild follows this import statically during the
// vercel-build step (see vercel.json buildCommand) and inlines the entire
// orchestrator chain into a single bundled api/index.js that Vercel deploys.
import { createApp } from '../src/server/createApp';

/**
 * Vercel serverless entry. The createApp() call is deferred to first request
 * (so we can catch + report errors as JSON), but the IMPORT itself is static
 * so esbuild bundles the whole orchestrator chain into the function output.
 *
 * /api/_diag is a special preflight that responds before createApp() runs —
 * useful when the constructor itself is the failure point.
 */

let app: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;
let constructError: Error | null = null;

function getApp() {
  if (!app && !constructError) {
    try {
      app = createApp() as unknown as (req: IncomingMessage, res: ServerResponse) => void;
    } catch (err: any) {
      constructError = err instanceof Error ? err : new Error(String(err));
    }
  }
  if (constructError) throw constructError;
  return app!;
}

function writeJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export default function handler(req: IncomingMessage, res: ServerResponse) {
  if ((req.url || '').startsWith('/api/_diag')) {
    return writeJson(res, 200, {
      ok: true,
      stage: 'pre-createApp',
      now: new Date().toISOString(),
      node: process.version,
      uptime: process.uptime(),
      env: {
        hasGeminiKey: !!process.env.GEMINI_API_KEY,
        hasGoogleMapsKey: !!process.env.GOOGLE_MAPS_PLATFORM_KEY,
        hasBlobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
        vercel: !!process.env.VERCEL,
        region: process.env.VERCEL_REGION,
        nodeEnv: process.env.NODE_ENV
      }
    });
  }

  try {
    const a = getApp();
    return a(req, res);
  } catch (err: any) {
    console.error('[api/index] Failed to construct app:', err);
    return writeJson(res, 500, {
      error: 'createApp() failed during cold start',
      message: err?.message || String(err),
      name: err?.name,
      stack: err?.stack?.split('\n').slice(0, 12).join('\n')
    });
  }
}
