import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { createApp } from './src/server/createApp';

dotenv.config();

const PORT = 3000;

async function startServer() {
  const app = createApp();

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
    app.get('*', (_req, res) => {
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
