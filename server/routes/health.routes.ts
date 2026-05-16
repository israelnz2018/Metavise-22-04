import { Router } from 'express';

export const healthRouter = Router();

// /api/test — lightweight backend liveness probe.
healthRouter.get('/test', (_req, res) => {
  res.json({ status: 'alive' });
});
