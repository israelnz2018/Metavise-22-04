import type { Request, Response } from 'express';

// 404 JSON response for unmatched /api/* routes — prevents Express from
// falling through to the Vite SPA handler and returning HTML for API calls.
export function apiNotFound(req: Request, res: Response): void {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` });
}
