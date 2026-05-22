// Minimal in-memory TTL cache for proxy endpoints. Used by the HeyGen
// avatar list and ElevenLabs shared-voices catalogs — both are slow
// upstream calls (1281 avatars / ~1k voices per page) that don't change
// minute-to-minute, so caching the parsed JSON for a few minutes makes
// page reloads feel instant without ever risking a stale-data UX
// problem worse than "your gallery is 10 minutes out of date."
//
// Single-process only (no Redis). Memory cap via maxEntries with LRU
// eviction so a long-running server doesn't grow unbounded on
// pagination-heavy traffic.
//
// Usage:
//   const cache = createTTLCache<MyType>({ ttlMs: 10 * 60_000 });
//   const cached = cache.get(key);
//   if (cached) return cached;
//   const fresh = await fetchFromUpstream();
//   cache.set(key, fresh);

interface Entry<T> {
  value: T;
  expiresAt: number;
  // Track insertion order for cheap LRU; refreshed on every read.
  lastUsed: number;
}

export interface TTLCacheOptions {
  /** Milliseconds before an entry is considered stale and dropped on read. */
  ttlMs: number;
  /** Max entries to retain. Oldest-by-`lastUsed` is evicted on overflow. */
  maxEntries?: number;
}

export interface TTLCache<T> {
  get: (key: string) => T | null;
  set: (key: string, value: T) => void;
  invalidate: (key?: string) => void;
  size: () => number;
}

export function createTTLCache<T>(opts: TTLCacheOptions): TTLCache<T> {
  const { ttlMs, maxEntries = 200 } = opts;
  const store = new Map<string, Entry<T>>();

  const get = (key: string): T | null => {
    const hit = store.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
      store.delete(key);
      return null;
    }
    hit.lastUsed = Date.now();
    return hit.value;
  };

  const set = (key: string, value: T): void => {
    if (store.size >= maxEntries && !store.has(key)) {
      // Evict least-recently-used entry. O(n) on overflow only — fine
      // for the small caches we use this for.
      let oldestKey: string | null = null;
      let oldestUsed = Infinity;
      for (const [k, v] of store) {
        if (v.lastUsed < oldestUsed) {
          oldestUsed = v.lastUsed;
          oldestKey = k;
        }
      }
      if (oldestKey !== null) store.delete(oldestKey);
    }
    store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
      lastUsed: Date.now(),
    });
  };

  const invalidate = (key?: string): void => {
    if (key === undefined) store.clear();
    else store.delete(key);
  };

  return { get, set, invalidate, size: () => store.size };
}
