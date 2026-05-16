import type { Request, Response, NextFunction } from 'express';
import { logToFile } from '../utils/fileLogger.js';

export function requestLogger(req: Request, _res: Response, next: NextFunction): void {
  if (req.url.startsWith('/api/')) {
    logToFile(`[Request] ${req.method} ${req.url}`);
  }
  next();
}
