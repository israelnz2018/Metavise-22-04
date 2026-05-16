import express from 'express';
import type { Express } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';

import { requestLogger } from './middleware/requestLogger.js';
import { cors } from './middleware/cors.js';
import { errorHandler } from './middleware/errorHandler.js';
import { apiNotFound } from './middleware/notFound.js';

import { userRouter } from './routes/user.routes.js';
import { healthRouter } from './routes/health.routes.js';
import { staticRouter } from './routes/static.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import { assemblyAIRouter } from './routes/assemblyai.routes.js';
import { runwayRouter } from './routes/runway.routes.js';
import { elevenLabsRouter, elevenLabsPremiumRouter } from './routes/elevenlabs.routes.js';
import { videoRouter } from './routes/video.routes.js';
import { heygenRouter, heygenPremiumRouter } from './routes/heygen.routes.js';
import { zapCapRouter, proxyImageRouter } from './routes/zapcap.routes.js';
import { geminiRouter } from './routes/gemini.routes.js';

// Builds and returns a fully wired Express app: middleware, routers, error
// handler, and the dev/prod SPA pipeline. Does NOT call listen() — see
// server/index.ts for the entry point.
export async function createApp(): Promise<Express> {
  const app = express();

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use(requestLogger);
  app.use(cors);

  // /generated must mount before the Vite SPA catch-all so static asset
  // requests don't fall through to the HTML.
  app.use('/generated', staticRouter);

  // API routers.
  app.use('/api/user', userRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', healthRouter);
  app.use('/api/assemblyai', assemblyAIRouter);
  app.use('/api/runway', runwayRouter);
  app.use('/api/elevenlabs', elevenLabsRouter);
  app.use('/api/elevenlabs-premium', elevenLabsPremiumRouter);
  app.use('/api/video', videoRouter);
  app.use('/api/heygen', heygenRouter);
  app.use('/api/heygen-premium', heygenPremiumRouter);
  app.use('/api/zapcap', zapCapRouter);
  app.use('/api/gemini', geminiRouter);
  app.use('/api', proxyImageRouter);

  // /api/* 404 + global error handler must come last in the API chain.
  app.all('/api/*', apiNotFound);
  app.use(errorHandler);

  // Dev: Vite middleware serves the SPA with HMR.
  // Prod: serve the pre-built dist/ and fall back to index.html.
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: `API route ${req.method} ${req.path} not found.` });
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}
