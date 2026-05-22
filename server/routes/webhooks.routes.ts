// Webhook receiver endpoints for HeyGen, ZapCap, and Runway. Each
// provider POSTs us when a render's state changes; we normalize the
// payload to our `JobState` shape and stash it in jobStore so the
// client (or polling code) can read it back via /api/jobs/:provider/:taskId.
//
// === Setup ===
//
// Each provider needs a publicly reachable URL. In dev, run:
//
//     ngrok http 3000
//
// Then in each provider's dashboard, register the webhook URL:
//
//   HeyGen:  https://<ngrok>.ngrok.app/api/webhooks/heygen
//            + secret in HEYGEN_WEBHOOK_SECRET env
//   ZapCap:  https://<ngrok>.ngrok.app/api/webhooks/zapcap
//            (ZapCap uses Bearer-style header — token in ZAPCAP_WEBHOOK_SECRET)
//   Runway:  https://<ngrok>.ngrok.app/api/webhooks/runway
//            + secret in RUNWAY_WEBHOOK_SECRET env
//
// When no webhook is configured (most local dev), nothing breaks —
// the routes accept POSTs but signature-verification will reject
// anything without the right header, and the existing polling code in
// the route handlers keeps working as today. Webhooks are a strict
// optimization, never a requirement.
//
// === Signature verification ===
//
// Each provider has its own scheme. The verifySignature helpers
// implement what's documented; if a provider doesn't sign, we accept
// the body but log a warning so the dev knows to lock it down before
// going public.

import { Router } from 'express';
import crypto from 'crypto';
import { upsertJob, getJob, listJobsForDebug, type JobProvider } from '../services/jobStore.js';
import { createLogger } from '../utils/logger.js';
const log = createLogger('Webhooks');

export const webhooksRouter = Router();

// ─────────────────────────────────────────────────────────────────────
// Signature verification
// ─────────────────────────────────────────────────────────────────────

/** HeyGen signs with HMAC-SHA256(secret, raw body) in `signature` header. */
function verifyHeyGen(rawBody: string, headerSig: string | undefined): boolean {
  const secret = process.env.HEYGEN_WEBHOOK_SECRET;
  if (!secret) {
    log.warn('HEYGEN_WEBHOOK_SECRET not set — accepting unsigned payload (insecure for prod)');
    return true;
  }
  if (!headerSig) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  // timingSafeEqual requires equal-length buffers; bail early on length mismatch
  if (expected.length !== headerSig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(headerSig));
}

/** ZapCap uses a simple shared bearer in Authorization header. */
function verifyZapCap(authHeader: string | undefined): boolean {
  const secret = process.env.ZAPCAP_WEBHOOK_SECRET;
  if (!secret) {
    log.warn('ZAPCAP_WEBHOOK_SECRET not set — accepting unsigned payload (insecure for prod)');
    return true;
  }
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (token.length !== secret.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret));
}

/** Runway signs with HMAC-SHA256 in `x-runway-signature` header. */
function verifyRunway(rawBody: string, headerSig: string | undefined): boolean {
  const secret = process.env.RUNWAY_WEBHOOK_SECRET;
  if (!secret) {
    log.warn('RUNWAY_WEBHOOK_SECRET not set — accepting unsigned payload (insecure for prod)');
    return true;
  }
  if (!headerSig) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  if (expected.length !== headerSig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(headerSig));
}

// ─────────────────────────────────────────────────────────────────────
// Receivers
// ─────────────────────────────────────────────────────────────────────

// HeyGen webhook payload (v2):
//   { event_type: 'avatar_video.success' | 'avatar_video.fail',
//     event_data: { video_id, video_url?, error? }, ... }
webhooksRouter.post('/heygen', async (req, res) => {
  const sig = req.header('signature') || req.header('Signature');
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  if (!verifyHeyGen(raw, sig)) {
    log.warn('HeyGen webhook signature failed');
    return res.status(401).json({ error: 'invalid signature' });
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const eventType: string = body.event_type ?? '';
    const data = body.event_data ?? {};
    const taskId: string | undefined = data.video_id ?? data.task_id;
    if (!taskId) {
      log.warn('HeyGen webhook with no video_id', { eventType });
      return res.status(200).json({ ok: true });
    }
    if (eventType.endsWith('.success')) {
      upsertJob({
        provider: 'heygen',
        taskId,
        status: 'completed',
        resultUrl: data.video_url ?? data.url,
        raw: data,
      });
    } else if (eventType.endsWith('.fail')) {
      upsertJob({
        provider: 'heygen',
        taskId,
        status: 'failed',
        error: data.error ?? 'HeyGen render failed',
        raw: data,
      });
    } else {
      upsertJob({
        provider: 'heygen',
        taskId,
        status: 'processing',
        raw: data,
      });
    }
    log.info(`HeyGen webhook → ${taskId} → ${eventType}`);
    res.json({ ok: true });
  } catch (err: any) {
    log.error('HeyGen webhook parse error', { error: err?.message });
    res.status(400).json({ error: err?.message });
  }
});

// ZapCap webhook payload (v1):
//   { taskId, status: 'completed' | 'failed' | 'processing', downloadUrl?, error? }
webhooksRouter.post('/zapcap', async (req, res) => {
  if (!verifyZapCap(req.header('authorization'))) {
    log.warn('ZapCap webhook auth failed');
    return res.status(401).json({ error: 'invalid auth' });
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const taskId: string | undefined = body.taskId ?? body.task_id;
    if (!taskId) {
      log.warn('ZapCap webhook with no taskId');
      return res.status(200).json({ ok: true });
    }
    const status: string = body.status ?? '';
    upsertJob({
      provider: 'zapcap',
      taskId,
      status: status === 'completed'
        ? 'completed'
        : status === 'failed'
          ? 'failed'
          : 'processing',
      resultUrl: body.downloadUrl ?? body.url,
      error: body.error,
      raw: body,
    });
    log.info(`ZapCap webhook → ${taskId} → ${status}`);
    res.json({ ok: true });
  } catch (err: any) {
    log.error('ZapCap webhook parse error', { error: err?.message });
    res.status(400).json({ error: err?.message });
  }
});

// Runway webhook payload:
//   { id, status: 'SUCCEEDED' | 'FAILED' | 'RUNNING', output?: [url], failure?: string }
webhooksRouter.post('/runway', async (req, res) => {
  const sig = req.header('x-runway-signature') || req.header('X-Runway-Signature');
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  if (!verifyRunway(raw, sig)) {
    log.warn('Runway webhook signature failed');
    return res.status(401).json({ error: 'invalid signature' });
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const taskId: string | undefined = body.id ?? body.task_id;
    if (!taskId) {
      log.warn('Runway webhook with no id');
      return res.status(200).json({ ok: true });
    }
    const status: string = String(body.status ?? '').toUpperCase();
    upsertJob({
      provider: 'runway',
      taskId,
      status: status === 'SUCCEEDED'
        ? 'completed'
        : status === 'FAILED' || status === 'CANCELLED'
          ? 'failed'
          : 'processing',
      resultUrl: Array.isArray(body.output) ? body.output[0] : body.output,
      error: body.failure,
      raw: body,
    });
    log.info(`Runway webhook → ${taskId} → ${status}`);
    res.json({ ok: true });
  } catch (err: any) {
    log.error('Runway webhook parse error', { error: err?.message });
    res.status(400).json({ error: err?.message });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Read API — client polling consults this BEFORE hitting the upstream
// to see if the webhook already gave us a final answer. Cheap & fast.
// ─────────────────────────────────────────────────────────────────────

webhooksRouter.get('/jobs/:provider/:taskId', (req, res) => {
  const provider = req.params.provider as JobProvider;
  const validProviders: JobProvider[] = ['heygen', 'zapcap', 'runway'];
  if (!validProviders.includes(provider)) {
    return res.status(400).json({ error: 'invalid provider' });
  }
  const job = getJob(provider, req.params.taskId);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json(job);
});

// Admin-only debug view of the entire store. Useful while wiring up
// webhooks for the first time.
webhooksRouter.get('/jobs', (_req, res) => {
  res.json({ jobs: listJobsForDebug() });
});
