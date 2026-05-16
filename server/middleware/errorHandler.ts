import type { Request, Response, NextFunction } from 'express';

interface HttpError extends Error {
  status?: number;
}

// Catches errors propagated via next(err) from any handler. Currently routes
// hand-roll their own try/catch and respond directly, so this fires rarely.
// Phase 10 will wrap async handlers with asyncRoute() so this becomes the
// single source of truth for /api/* error responses.
export function errorHandler(
  err: HttpError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  console.error(`[Server Error] ${req.method} ${req.path}:`, err);
  if (req.path.startsWith('/api/')) {
    res.status(err.status ?? 500).json({
      error: err.message || 'Internal Server Error',
      path: req.path,
    });
    return;
  }
  next(err);
}
