// Cache utility tests — covers TTL expiry + LRU eviction. Used by the
// HeyGen avatars + ElevenLabs voices proxy endpoints to spare upstream
// calls within a 10-minute window.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createTTLCache } from '../server/utils/cache';

describe('createTTLCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores and returns values under TTL', () => {
    const c = createTTLCache<number>({ ttlMs: 1000 });
    c.set('a', 42);
    expect(c.get('a')).toBe(42);
  });

  it('returns null after TTL expires', () => {
    const c = createTTLCache<number>({ ttlMs: 1000 });
    c.set('a', 42);
    vi.advanceTimersByTime(1500);
    expect(c.get('a')).toBeNull();
  });

  it('returns null for unknown keys', () => {
    const c = createTTLCache<string>({ ttlMs: 1000 });
    expect(c.get('missing')).toBeNull();
  });

  it('evicts LRU entry when maxEntries is exceeded', () => {
    const c = createTTLCache<number>({ ttlMs: 1000, maxEntries: 2 });
    c.set('a', 1);
    vi.advanceTimersByTime(10);
    c.set('b', 2);
    vi.advanceTimersByTime(10);
    // Touch 'a' so 'b' becomes the LRU candidate.
    c.get('a');
    vi.advanceTimersByTime(10);
    c.set('c', 3); // pushes us to maxEntries=2 + 1 → 'b' evicted
    expect(c.get('a')).toBe(1);
    expect(c.get('b')).toBeNull();
    expect(c.get('c')).toBe(3);
  });

  it('invalidate(key) drops one entry; invalidate() drops all', () => {
    const c = createTTLCache<number>({ ttlMs: 1000 });
    c.set('a', 1);
    c.set('b', 2);
    c.invalidate('a');
    expect(c.get('a')).toBeNull();
    expect(c.get('b')).toBe(2);
    c.invalidate();
    expect(c.get('b')).toBeNull();
    expect(c.size()).toBe(0);
  });

  it('overwrites existing key without growing past maxEntries', () => {
    const c = createTTLCache<number>({ ttlMs: 1000, maxEntries: 2 });
    c.set('a', 1);
    c.set('a', 2);
    c.set('b', 3);
    expect(c.size()).toBe(2);
    expect(c.get('a')).toBe(2);
    expect(c.get('b')).toBe(3);
  });
});
