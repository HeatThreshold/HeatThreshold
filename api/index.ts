import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Vercel serverless entry. The Express app is constructed lazily inside the
 * handler so any thrown error during createApp() can be returned as a real
 * JSON response instead of triggering FUNCTION_INVOCATION_FAILED (the Vercel
 * HTML page that swallows the stack).
 *
 * /api/_diag is a special preflight that responds before createApp is even
 * imported — useful when the orchestrator chain itself is the failure point.
 */

let appPromise: Promise<(req: IncomingMessage, res: ServerResponse) => void> | null = null;
async function getApp() {
  if (!appPromise) {
    appPromise = (async () => {
      const mod = await import('../src/server/createApp');
      return mod.createApp() as unknown as (req: IncomingMessage, res: ServerResponse) => void;
    })();
  }
  return appPromise;
}

function writeJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // Pre-createApp diagnostic. Works even when the orchestrator chain blows up
  // on import — answers the question "is the function even loading?"
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
    const app = await getApp();
    return app(req, res);
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
