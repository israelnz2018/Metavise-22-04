// Tests for the requireAuth middleware in dev mode. Verifies:
// 1. Missing token → dev-user uid
// 2. Token present → uid extracted via unsafe JWT decode (no signature check in dev)

import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../server/middleware/auth.js';

function makeReq(authHeader?: string): Request {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  } as Request;
}

function makeRes() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { status, json } as unknown as Response;
}

describe('requireAuth (dev mode)', () => {
  it('assigns dev-user uid when no token is present', async () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    await requireAuth(req, res, next);
    expect(req.user?.uid).toBe('dev-user');
    expect(next).toHaveBeenCalled();
  });

  it('extracts uid from a Bearer JWT (unsafe decode)', async () => {
    // Build a minimal JWT: header.payload.signature (b64url segments).
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ user_id: 'real-user-123' })).toString('base64url');
    const token = `${header}.${payload}.sig`;

    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    await requireAuth(req, res, next);
    expect(req.user?.uid).toBe('real-user-123');
    expect(next).toHaveBeenCalled();
  });

  it('falls back to dev-user when token is malformed', async () => {
    const req = makeReq('Bearer not.a.real.jwt');
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    await requireAuth(req, res, next);
    expect(req.user?.uid).toBe('dev-user');
    expect(next).toHaveBeenCalled();
  });
});
