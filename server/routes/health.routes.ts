import { Router } from 'express';
import { getQueueStats } from '../services/jobQueue.js';

export const healthRouter = Router();

// /api/test — lightweight backend liveness probe.
healthRouter.get('/test', (_req, res) => {
  res.json({ status: 'alive' });
});

// /api/queue-status — surface job-queue depth so you can spot pile-ups
// without scraping logs. Useful during a busy render burst.
healthRouter.get('/queue-status', (_req, res) => {
  res.json(getQueueStats());
});
