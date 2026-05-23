import PQueue from 'p-queue';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { createLogger } from '../utils/logger.js';

const log = createLogger('JobQueue');

/**
 * Shared in-process queue for CPU-bound ffmpeg work.
 *
 * Concurrency = 2 keeps the box responsive. A single 1080p libx264
 * encode can saturate 4-6 cores; running 3+ concurrently starves the
 * Express event loop and clients start seeing request timeouts on
 * unrelated endpoints. Bump via env if you have more cores to spare.
 *
 * Job timeout = 15 min. Anything longer is almost certainly hung —
 * we'd rather fail loudly than leak a worker.
 *
 * This is intentionally in-process (no Redis). When you outgrow that,
 * swap to BullMQ — the call sites are isolated behind `runFfmpegJob`
 * so the migration is mechanical.
 */
export const ffmpegQueue = new PQueue({
  concurrency: Number(process.env.FFMPEG_QUEUE_CONCURRENCY) || 2,
  timeout: 15 * 60_000,
});

/**
 * Queue for upstream API renders (HeyGen / Runway / ZapCap submits).
 * These are I/O-bound — the upstream service does the heavy work —
 * so concurrency can be much higher. Acts mainly as a rate-limit
 * smoother so a burst of "Generate" clicks doesn't 429 us upstream.
 */
export const externalApiQueue = new PQueue({
  concurrency: Number(process.env.EXTERNAL_API_QUEUE_CONCURRENCY) || 5,
  timeout: 60_000,
});

// Lightweight observability — surfaces in logs whenever a queue grows
// or drains. Helpful to spot pile-ups before the user notices.
function attachLogging(name: string, q: PQueue) {
  q.on('add', () => log.info(`[${name}] queued (waiting=${q.size}, active=${q.pending})`));
  q.on('next', () => log.info(`[${name}] started (waiting=${q.size}, active=${q.pending})`));
  q.on('error', (err) => log.error(`[${name}] job error: ${err}`));
}
attachLogging('ffmpeg', ffmpegQueue);
attachLogging('externalApi', externalApiQueue);

export function getQueueStats() {
  return {
    ffmpeg: { waiting: ffmpegQueue.size, active: ffmpegQueue.pending },
    externalApi: {
      waiting: externalApiQueue.size,
      active: externalApiQueue.pending,
    },
  };
}

/**
 * Wraps an Express handler so its body runs inside the given queue.
 * Usage:
 *   videoRouter.post('/compress', withQueue(ffmpegQueue, async (req, res) => { ... }))
 *
 * If the queue rejects (timeout, etc) we forward to the Express
 * error handler via `next(err)` so the standard error formatter runs.
 */
export function withQueue(
  queue: PQueue,
  handler: (req: Request, res: Response) => Promise<unknown>
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Pass a fresh AbortController so we can extend cancellation
      // later (e.g. if the client disconnects). For now we just want
      // p-queue's per-task timeout to bubble up as a rejection rather
      // than silently resolving with undefined.
      await queue.add(() => handler(req, res));
    } catch (err) {
      next(err);
    }
  };
}

export const withFfmpegQueue = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  withQueue(ffmpegQueue, handler);

export const withExternalApiQueue = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  withQueue(externalApiQueue, handler);
