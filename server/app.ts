import express from 'express';
import type { Express } from 'express';
import compression from 'compression';
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
import { heygenRouter } from './routes/heygen.routes.js';
import { zapCapRouter, proxyImageRouter } from './routes/zapcap.routes.js';
import { geminiRouter } from './routes/gemini.routes.js';
import { claudeRouter } from './routes/claude.routes.js';
import { pexelsRouter } from './routes/pexels.routes.js';
import { falRouter } from './routes/fal.routes.js';
import { webhooksRouter } from './routes/webhooks.routes.js';
import { telemetryRouter } from './routes/telemetry.routes.js';
import { requireAuth } from './middleware/auth.js';

// Builds and returns a fully wired Express app: middleware, routers, error
// handler, and the dev/prod SPA pipeline. Does NOT call listen() — see
// server/index.ts for the entry point.
export async function createApp(): Promise<Express> {
  const app = express();

  // gzip/brotli for all responses by default. Express's default
  // threshold (1KB) is sane — anything smaller skips compression
  // because the gzip overhead would outweigh the savings. We don't
  // try to compress already-compressed media: the middleware checks
  // `content-encoding` and `content-type` and bails on video/*, image/*.
  app.use(compression());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use(requestLogger);
  app.use(cors);

  // /generated must mount before the Vite SPA catch-all so static asset
  // requests don't fall through to the HTML.
  app.use('/generated', staticRouter);

  // API routers. `requireAuth` protege os endpoints que GASTAM (IA/render/APIs
  // pagas): em produção (nuvem) exige o login do Firebase que o front já envia;
  // em dev fica aberto (DEV_MODE) — então nada muda localmente. Assim a URL
  // pública da nuvem não vira um serviço de render aberto que queima dinheiro.
  // Válvula de escape: env AUTH_DISABLED=1 reabre tudo se precisar.
  app.use('/api/user', userRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', healthRouter);
  app.use('/api/assemblyai', requireAuth, assemblyAIRouter);
  app.use('/api/runway', requireAuth, runwayRouter);
  app.use('/api/elevenlabs', requireAuth, elevenLabsRouter);
  app.use('/api/elevenlabs-premium', requireAuth, elevenLabsPremiumRouter);
  app.use('/api/video', requireAuth, videoRouter);
  app.use('/api/heygen', requireAuth, heygenRouter);
  app.use('/api/zapcap', requireAuth, zapCapRouter);
  app.use('/api/gemini', requireAuth, geminiRouter);
  app.use('/api/claude', requireAuth, claudeRouter);
  app.use('/api/pexels', requireAuth, pexelsRouter);
  app.use('/api/fal', requireAuth, falRouter);
  // Webhook receivers (HeyGen/ZapCap/Runway) + job-state read API.
  // Mounted under /api/webhooks for the POSTs, but the GET /jobs/...
  // endpoint also lives under it. See webhooks.routes.ts for setup.
  app.use('/api/webhooks', webhooksRouter);
  app.use('/api/telemetry', telemetryRouter);
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
