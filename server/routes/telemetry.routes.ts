import { Router } from 'express';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Telemetry');

export const telemetryRouter = Router();

interface WebVitalPayload {
  name: string;
  value: number;
  rating?: 'good' | 'needs-improvement' | 'poor';
  delta?: number;
  id?: string;
  navigationType?: string;
  path?: string;
  ts?: number;
}

/**
 * POST /api/telemetry/web-vitals
 *
 * Receives Core Web Vitals beacons from the client (see
 * src/lib/webVitals.ts). Today we just log structured lines — easy
 * to grep, no DB cost. Promote to a real store (BigQuery / Firestore
 * collection) when you want historical trends.
 *
 * Returns 204 No Content because sendBeacon doesn't read responses.
 */
telemetryRouter.post('/web-vitals', (req, res) => {
  const m = req.body as WebVitalPayload | undefined;

  // Defensive: a malformed beacon shouldn't blow up the route.
  if (!m || typeof m.name !== 'string' || typeof m.value !== 'number') {
    return res.status(204).end();
  }

  log.info(
    `[WebVitals] ${m.name}=${m.value.toFixed(2)} ` +
      `rating=${m.rating ?? 'n/a'} path=${m.path ?? '/'} ` +
      `nav=${m.navigationType ?? 'n/a'}`
  );

  res.status(204).end();
});
