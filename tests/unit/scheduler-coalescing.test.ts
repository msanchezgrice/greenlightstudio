import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(), createDb: vi.fn(), result: { data: null as {id:string}|null, error: null as {message:string}|null },
  query: {} as Record<string, ReturnType<typeof vi.fn>>,
}));
vi.mock('@/lib/jobs/enqueue', () => ({ enqueueJob: mocks.enqueue }));
vi.mock('@/lib/supabase', () => ({ createServiceSupabase: mocks.createDb }));
import { GET } from '../../src/app/api/scheduler/run/route';

describe('scheduler pending-tick coalescing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'synthetic-cron-verification-only');
    mocks.result = { data: null, error: null };
    mocks.query = {};
    for (const name of ['select', 'eq', 'in', 'order', 'limit']) mocks.query[name] = vi.fn(() => mocks.query);
    mocks.query.maybeSingle = vi.fn(async () => mocks.result);
    mocks.createDb.mockReturnValue({ from: vi.fn(() => mocks.query) });
    mocks.enqueue.mockResolvedValue('new-synthetic-tick');
  });
  const request = () => new Request('https://owned-test.invalid/api/scheduler/run', {headers:{authorization:'Bearer synthetic-cron-verification-only'}});

  it('returns the existing pending tick without adding another job', async () => {
    mocks.result.data = {id:'pending-synthetic-tick'};
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect((await res.json()).jobId).toBe('pending-synthetic-tick');
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.query.eq).toHaveBeenCalledWith('project_id', '00000000-0000-0000-0000-000000000000');
    expect(mocks.query.eq).toHaveBeenCalledWith('job_type', 'scheduler.run_recurring');
    expect(mocks.query.in).toHaveBeenCalledWith('status', ['queued','running']);
  });
  it('fails closed if checking existing work is unavailable', async () => {
    mocks.result.error = {message:'synthetic unavailability'};
    const res = await GET(request());
    expect(res.status).toBe(503);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(JSON.stringify(await res.json())).not.toContain('synthetic unavailability');
  });
  it('preserves the original minute-idempotent enqueue when no work is pending', async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue.mock.calls[0][0]).toMatchObject({projectId:'00000000-0000-0000-0000-000000000000',jobType:'scheduler.run_recurring'});
    expect(mocks.enqueue.mock.calls[0][0].idempotencyKey).toMatch(/^scheduler:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
  it('denies an unauthenticated request before database access', async () => {
    const res = await GET(new Request('https://owned-test.invalid/api/scheduler/run'));
    expect(res.status).toBe(401);
    expect(mocks.createDb).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
