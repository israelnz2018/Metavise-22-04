import type { Request, Response, NextFunction } from 'express';

// Permissive CORS — the SPA is served from the same origin in production, but
// dev environments occasionally hit /api from other ports.
export function cors(_req: Request, res: Response, next: NextFunction): void {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
}
