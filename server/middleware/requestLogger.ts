import type { Request, Response, NextFunction } from 'express';
import { logToFile } from '../utils/fileLogger.js';

// URLs that the client polls aggressively. We still want to log a
// summary so we can spot pathological loops, but every individual
// hit drowns the log file (see debug_logs.txt: /api/gemini/key was
// logged 4x per mount). Bucket these into a periodic summary.
const HIGH_FREQUENCY_PATHS = new Set([
  '/api/gemini/key',
  '/api/test',
  '/api/queue-status',
  '/api/telemetry/web-vitals',
]);

const recentNoisyHits = new Map<string, { count: number; firstAt: number }>();
const NOISY_FLUSH_MS = 30_000;

function flushNoisy() {
  const now = Date.now();
  for (const [key, info] of recentNoisyHits) {
    if (now - info.firstAt >= NOISY_FLUSH_MS) {
      logToFile(
        `[Request] ${key} x${info.count} in last ${Math.round((now - info.firstAt) / 1000)}s`
      );
      recentNoisyHits.delete(key);
    }
  }
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  if (!req.url.startsWith('/api/')) {
    return next();
  }

  const start = process.hrtime.bigint();
  const url = req.url;
  const method = req.method;

  // Bucket noisy polls instead of logging each one. Still emit a
  // periodic summary so an exploding loop is visible.
  if (HIGH_FREQUENCY_PATHS.has(url)) {
    const key = `${method} ${url}`;
    const entry = recentNoisyHits.get(key);
    if (entry) entry.count += 1;
    else recentNoisyHits.set(key, { count: 1, firstAt: Date.now() });
    flushNoisy();
    return next();
  }

  // Log the in-flight request immediately so a crash mid-handler still
  // leaves a trace. Then log the response on 'finish' with status +
  // duration. 'close' covers the client-abort case.
  logToFile(`[Request] ${method} ${url}`);

  let logged = false;
  const logFinish = (event: 'finish' | 'close') => {
    if (logged) return;
    logged = true;
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    logToFile(
      `[Response] ${method} ${url} ${res.statusCode} ` +
        `${durationMs.toFixed(1)}ms${event === 'close' && !res.writableEnded ? ' (client-abort)' : ''}`
    );
  };

  res.once('finish', () => logFinish('finish'));
  res.once('close', () => logFinish('close'));

  next();
}
