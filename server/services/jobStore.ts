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
// Single-process / in-memory — fine for a single tsx server. For
// horizontally-scaled prod, swap for Redis with the same interface.

export type JobProvider = 'heygen' | 'zapcap' | 'runway';

export type JobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

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

function evictExpired() {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of store) {
    if (v.updatedAt < cutoff) store.delete(k);
  }
  if (store.size > MAX_ENTRIES) {
    // Drop oldest until under cap.
    const sorted = [...store.entries()].sort(
      (a, b) => a[1].updatedAt - b[1].updatedAt,
    );
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
  return next;
}

export function getJob(provider: JobProvider, taskId: string): JobState | null {
  evictExpired();
  return store.get(key(provider, taskId)) ?? null;
}

export function listJobsForDebug(): JobState[] {
  return [...store.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Test-only: wipe all state. */
export function _resetJobStore() {
  store.clear();
}
