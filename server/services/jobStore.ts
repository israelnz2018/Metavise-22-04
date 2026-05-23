// In-memory job state cache that bridges upstream webhook callbacks
// to client-side polling. Each provider's render API gives us a
// `task_id` / `video_id` / `job_id` when we kick off a render — we
// then have two choices for finding out when it's done:
//
//   1. Long polling: ask the upstream every N seconds (current code).
//   2. Webhook: provider POSTs us when the job state changes.
//
// (2) is faster (no 5s round-trip), cheaper (no wasted requests), and
// kinder to upstream rate limits. But it only works when the server
// has a publicly reachable URL — ngrok in dev, real domain in prod.
//
// This module is the glue: webhook receivers push state in, client
// polling reads state out via /api/jobs/:provider/:taskId. When the
// webhook isn't configured (or hasn't fired yet for a fresh task),
// the GET endpoint returns null and the client falls back to its
// own polling against the upstream — same behavior as today.
//
// PERSISTENCE: state is mirrored to disk (.jobstore.json under
// GENERATED_DIR) via a debounced writer. On module load we replay
// whatever's there so a server restart doesn't black-hole in-flight
// jobs. Writes are atomic (tmp + rename) so a crash mid-write doesn't
// leave a corrupt file. Tests bypass via NODE_ENV=test.

import fs from 'fs';
import path from 'path';
import { GENERATED_DIR } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('JobStore');

const STORE_FILE = path.join(GENERATED_DIR, '.jobstore.json');
const TMP_FILE = STORE_FILE + '.tmp';
const PERSIST = process.env.NODE_ENV !== 'test';
const WRITE_DEBOUNCE_MS = 500;

export type JobProvider = 'heygen' | 'zapcap' | 'runway';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface JobState {
  provider: JobProvider;
  taskId: string;
  status: JobStatus;
  /** Final asset URL on success — varies per provider (mp4 / hosted page / etc.). */
  resultUrl?: string;
  /** Human-readable reason on failure (provider-specific). */
  error?: string;
  /** Provider-specific metadata kept verbatim for the client. */
  raw?: unknown;
  /** Set on first webhook arrival; updated on each subsequent one. */
  updatedAt: number;
}

const TTL_MS = 24 * 60 * 60_000; // 24h — long enough for the slowest render
const MAX_ENTRIES = 1000;

const store = new Map<string, JobState>();

const key = (provider: JobProvider, taskId: string) => `${provider}:${taskId}`;

// --- Persistence layer -----------------------------------------------------

let writeTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleWrite() {
  if (!PERSIST) return;
  if (writeTimer) return; // already scheduled
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flushToDisk();
  }, WRITE_DEBOUNCE_MS);
}

function flushToDisk() {
  if (!PERSIST) return;
  try {
    const snapshot: Record<string, JobState> = Object.fromEntries(store);
    // Write to a temp path then rename — atomic on POSIX, so a crash
    // mid-write leaves either the old file or the new, never garbage.
    fs.writeFileSync(TMP_FILE, JSON.stringify(snapshot));
    fs.renameSync(TMP_FILE, STORE_FILE);
  } catch (err: any) {
    // Persistence is best-effort. Disk full / permission error shouldn't
    // crash the server; in-memory state is the source of truth at
    // runtime anyway.
    log.warn('Persistence write failed:', err?.message ?? err);
  }
}

function loadFromDisk() {
  if (!PERSIST) return;
  try {
    if (!fs.existsSync(STORE_FILE)) return;
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, JobState>;
    let restored = 0;
    for (const [k, v] of Object.entries(parsed)) {
      if (v && typeof v.updatedAt === 'number') {
        store.set(k, v);
        restored++;
      }
    }
    if (restored > 0) {
      log.info(`Restored ${restored} job(s) from disk`);
    }
    // Run an eviction pass so we don't ship boot with stale entries.
    evictExpired();
  } catch (err: any) {
    log.warn('Persistence load failed:', err?.message ?? err);
  }
}

// Replay on module load. Safe to call at import time — fs.existsSync is
// synchronous and the file is tiny (<100KB even for 1000 jobs).
loadFromDisk();

function evictExpired() {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of store) {
    if (v.updatedAt < cutoff) store.delete(k);
  }
  if (store.size > MAX_ENTRIES) {
    // Drop oldest until under cap.
    const sorted = [...store.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    while (store.size > MAX_ENTRIES && sorted.length) {
      const [k] = sorted.shift()!;
      store.delete(k);
    }
  }
}

export function upsertJob(state: Omit<JobState, 'updatedAt'>): JobState {
  const next: JobState = { ...state, updatedAt: Date.now() };
  store.set(key(state.provider, state.taskId), next);
  evictExpired();
  scheduleWrite();
  return next;
}

export function getJob(provider: JobProvider, taskId: string): JobState | null {
  evictExpired();
  return store.get(key(provider, taskId)) ?? null;
}

export function listJobsForDebug(): JobState[] {
  return [...store.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Test-only: wipe all state (does not touch disk in PERSIST mode). */
export function _resetJobStore() {
  store.clear();
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
}

/** Force-flush pending writes synchronously. Call from graceful-shutdown
 *  handlers so in-flight upserts don't get lost in the debounce window. */
export function flushJobStore(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  flushToDisk();
}
