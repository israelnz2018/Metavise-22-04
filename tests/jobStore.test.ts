// Tests for the in-memory job state cache that bridges upstream
// webhook callbacks to client polling. Focused on the public surface:
// upsert / get / TTL eviction behavior.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  upsertJob,
  getJob,
  _resetJobStore,
} from '../server/services/jobStore';

describe('jobStore', () => {
  beforeEach(() => {
    _resetJobStore();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('upserts and reads back a job', () => {
    upsertJob({
      provider: 'heygen',
      taskId: 'vid_abc',
      status: 'processing',
    });
    const job = getJob('heygen', 'vid_abc');
    expect(job?.status).toBe('processing');
    expect(job?.provider).toBe('heygen');
    expect(job?.updatedAt).toBeGreaterThan(0);
  });

  it('returns null for unknown task', () => {
    expect(getJob('heygen', 'never_seen')).toBeNull();
  });

  it('overwrites an existing job with newer state', () => {
    upsertJob({ provider: 'zapcap', taskId: 'z1', status: 'processing' });
    vi.advanceTimersByTime(1000);
    upsertJob({
      provider: 'zapcap',
      taskId: 'z1',
      status: 'completed',
      resultUrl: 'https://example.com/done.mp4',
    });
    const job = getJob('zapcap', 'z1');
    expect(job?.status).toBe('completed');
    expect(job?.resultUrl).toBe('https://example.com/done.mp4');
  });

  it('keys are namespaced per provider — same taskId across providers is independent', () => {
    upsertJob({ provider: 'heygen', taskId: 'shared_id', status: 'completed' });
    upsertJob({ provider: 'runway', taskId: 'shared_id', status: 'failed' });
    expect(getJob('heygen', 'shared_id')?.status).toBe('completed');
    expect(getJob('runway', 'shared_id')?.status).toBe('failed');
  });

  it('evicts entries older than 24h on next operation', () => {
    upsertJob({ provider: 'runway', taskId: 'old_one', status: 'completed' });
    expect(getJob('runway', 'old_one')?.status).toBe('completed');
    // Jump past the 24h TTL.
    vi.advanceTimersByTime(25 * 60 * 60_000);
    // Trigger eviction via any read.
    upsertJob({ provider: 'runway', taskId: 'fresh', status: 'processing' });
    expect(getJob('runway', 'old_one')).toBeNull();
    expect(getJob('runway', 'fresh')?.status).toBe('processing');
  });
});
