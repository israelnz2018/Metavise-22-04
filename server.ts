import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';

import { ensureGeneratedDir } from './server/config/paths.js';
import { initFirebase } from './server/config/firebase.js';
import { setupFfmpeg } from './server/config/ffmpeg.js';
import { requestLogger } from './server/middleware/requestLogger.js';
import { cors } from './server/middleware/cors.js';
import { errorHandler } from './server/middleware/errorHandler.js';
import { apiNotFound } from './server/middleware/notFound.js';

import { userRouter } from './server/routes/user.routes.js';
import { healthRouter } from './server/routes/health.routes.js';
import { staticRouter } from './server/routes/static.routes.js';
import { adminRouter } from './server/routes/admin.routes.js';
import { assemblyAIRouter } from './server/routes/assemblyai.routes.js';
import { runwayRouter } from './server/routes/runway.routes.js';
import { elevenLabsRouter, elevenLabsPremiumRouter } from './server/routes/elevenlabs.routes.js';
import { videoRouter } from './server/routes/video.routes.js';
import { heygenRouter, heygenPremiumRouter } from './server/routes/heygen.routes.js';
import { zapCapRouter, proxyImageRouter } from './server/routes/zapcap.routes.js';

dotenv.config();
setupFfmpeg();
ensureGeneratedDir();
initFirebase();

async function startServer() {
  const app = express();
  const PORT = 3000;

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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
