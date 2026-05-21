// Integration tests for backend routes. Uses createApp() to build the
// Express app without listen() — supertest hits it directly. Routes that
// call out to third-party APIs (HeyGen, AssemblyAI, etc.) are not tested
// here; we focus on the local-only paths (auth, credits, 404 fallthrough).

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../server/app.js';

let app: Express;

beforeAll(async () => {
  app = await createApp();
});

describe('backend routes', () => {
  it('GET unknown /api/* returns 404 with JSON error', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/);
  });

  it('GET /api/user/credits returns balance for dev-user', async () => {
    const res = await request(app).get('/api/user/credits');
    expect(res.status).toBe(200);
    expect(typeof res.body.credits).toBe('number');
    expect(res.body.credits).toBeGreaterThanOrEqual(0);
  });

  it('GET /api/user/credits/history returns transactions array', async () => {
    const res = await request(app).get('/api/user/credits/history');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.transactions)).toBe(true);
  });

  it('POST /api/claude/extract-product-info requires text or url', async () => {
    const res = await request(app)
      .post('/api/claude/extract-product-info')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/text|url|youtubeUrl/i);
  });
});
