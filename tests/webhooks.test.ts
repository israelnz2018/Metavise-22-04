// Integration tests for the webhook receivers + the /jobs read API.
// Verifies: signature acceptance (unsigned dev path), event-type
// normalization to JobState shape, and the GET round-trip.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../server/app.js';
import { _resetJobStore } from '../server/services/jobStore.js';

let app: Express;

beforeAll(async () => {
  app = await createApp();
});

beforeEach(() => {
  _resetJobStore();
  // Tests run without webhook secrets set so signature verification
  // accepts the body and just logs a warning (dev-friendly default).
  delete process.env.HEYGEN_WEBHOOK_SECRET;
  delete process.env.ZAPCAP_WEBHOOK_SECRET;
  delete process.env.RUNWAY_WEBHOOK_SECRET;
});

describe('POST /api/webhooks/heygen', () => {
  it('normalizes a success event into a completed JobState', async () => {
    const res = await request(app)
      .post('/api/webhooks/heygen')
      .send({
        event_type: 'avatar_video.success',
        event_data: {
          video_id: 'hg_abc123',
          video_url: 'https://heygen.example/done.mp4',
        },
      });
    expect(res.status).toBe(200);
    const job = await request(app).get('/api/webhooks/jobs/heygen/hg_abc123');
    expect(job.status).toBe(200);
    expect(job.body.status).toBe('completed');
    expect(job.body.resultUrl).toBe('https://heygen.example/done.mp4');
  });

  it('normalizes a fail event into a failed JobState', async () => {
    await request(app)
      .post('/api/webhooks/heygen')
      .send({
        event_type: 'avatar_video.fail',
        event_data: { video_id: 'hg_xyz', error: 'rate limited' },
      });
    const job = await request(app).get('/api/webhooks/jobs/heygen/hg_xyz');
    expect(job.body.status).toBe('failed');
    expect(job.body.error).toBe('rate limited');
  });
});

describe('POST /api/webhooks/zapcap', () => {
  it('records a completed render', async () => {
    await request(app)
      .post('/api/webhooks/zapcap')
      .send({
        taskId: 'zc_42',
        status: 'completed',
        downloadUrl: 'https://zap.example/v.mp4',
      });
    const job = await request(app).get('/api/webhooks/jobs/zapcap/zc_42');
    expect(job.body.status).toBe('completed');
    expect(job.body.resultUrl).toBe('https://zap.example/v.mp4');
  });
});

describe('POST /api/webhooks/runway', () => {
  it('maps SUCCEEDED to completed and grabs first output URL', async () => {
    await request(app)
      .post('/api/webhooks/runway')
      .send({
        id: 'rw_99',
        status: 'SUCCEEDED',
        output: ['https://runway.example/clip.mp4'],
      });
    const job = await request(app).get('/api/webhooks/jobs/runway/rw_99');
    expect(job.body.status).toBe('completed');
    expect(job.body.resultUrl).toBe('https://runway.example/clip.mp4');
  });
});

describe('GET /api/webhooks/jobs/:provider/:taskId', () => {
  it('returns 404 for unknown task', async () => {
    const res = await request(app).get('/api/webhooks/jobs/heygen/nope');
    expect(res.status).toBe(404);
  });

  it('rejects invalid provider', async () => {
    const res = await request(app).get('/api/webhooks/jobs/bogus/anything');
    expect(res.status).toBe(400);
  });
});

describe('signature enforcement (when secret IS set)', () => {
  it('rejects HeyGen webhook without signature when secret is configured', async () => {
    process.env.HEYGEN_WEBHOOK_SECRET = 'test-secret';
    const res = await request(app)
      .post('/api/webhooks/heygen')
      .send({ event_type: 'avatar_video.success', event_data: { video_id: 'x' } });
    expect(res.status).toBe(401);
  });
});
