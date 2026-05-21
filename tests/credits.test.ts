// Tests for creditsService — exercises the in-memory dev fallback path
// (firebase-admin isn't initialized in test env, so the service uses its
// per-uid memory map).

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCredits,
  hasCredits,
  deductCredits,
  creditUser,
} from '../server/services/creditsService.js';

const TEST_UID = `test-user-${Date.now()}`;

describe('creditsService (in-memory fallback)', () => {
  let uid: string;
  beforeEach(() => {
    uid = `${TEST_UID}-${Math.random().toString(36).slice(2, 8)}`;
  });

  it('new user starts with welcome credits', async () => {
    const balance = await getCredits(uid);
    expect(balance).toBe(100);
  });

  it('hasCredits returns true when balance >= amount', async () => {
    expect(await hasCredits(uid, 50)).toBe(true);
    expect(await hasCredits(uid, 100)).toBe(true);
    expect(await hasCredits(uid, 101)).toBe(false);
  });

  it('deductCredits decrements balance and returns new value', async () => {
    const after = await deductCredits(uid, 30, 'test-op');
    expect(after).toBe(70);
    expect(await getCredits(uid)).toBe(70);
  });

  it('deductCredits throws when insufficient', async () => {
    await expect(deductCredits(uid, 9999, 'test-op')).rejects.toThrow(
      /insuficientes/,
    );
  });

  it('creditUser increments balance', async () => {
    const after = await creditUser(uid, 50, 'top-up');
    expect(after).toBe(150);
    expect(await getCredits(uid)).toBe(150);
  });

  it('multiple users have independent balances', async () => {
    const uidA = `${uid}-A`;
    const uidB = `${uid}-B`;
    await deductCredits(uidA, 30, 'a-op');
    expect(await getCredits(uidA)).toBe(70);
    expect(await getCredits(uidB)).toBe(100); // untouched
  });
});
