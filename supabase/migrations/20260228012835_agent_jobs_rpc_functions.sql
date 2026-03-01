-- RPC: claim jobs using SKIP LOCKED
create or replace function public.claim_agent_jobs(p_worker_id text, p_limit int default 5)
returns setof public.agent_jobs
language plpgsql
as $$
begin
  return query
  with next_jobs as (
    select id
    from public.agent_jobs
    where status = 'queued'
      and run_after <= now()
    order by priority desc, created_at asc
    limit p_limit
    for update skip locked
  )
  update public.agent_jobs j
  set status = 'running',
      locked_at = now(),
      locked_by = p_worker_id,
      started_at = coalesce(started_at, now()),
      attempts = attempts + 1
  from next_jobs
  where j.id = next_jobs.id
  returning j.*;
end;
$$;

-- RPC: mark job completed/failed
create or replace function public.complete_agent_job(p_job_id uuid, p_status text, p_error text default null)
returns void
language plpgsql
as $$
begin
  update public.agent_jobs
  set status = p_status,
      last_error = p_error,
      completed_at = case when p_status = 'completed' then now() else completed_at end
  where id = p_job_id;
end;
$$;

-- RPC: reclaim stale jobs from crashed workers
create or replace function public.reclaim_stale_jobs(p_stale_threshold interval default '10 minutes')
returns int
language plpgsql
as $$
declare
  reclaimed int;
begin
  with stale as (
    select id
    from public.agent_jobs
    where status = 'running'
      and locked_at < now() - p_stale_threshold
      and attempts < max_attempts
    for update skip locked
  )
  update public.agent_jobs j
  set status = 'queued',
      locked_at = null,
      locked_by = null,
      last_error = 'reclaimed: worker presumed dead'
  from stale
  where j.id = stale.id;

  get diagnostics reclaimed = row_count;
  return reclaimed;
end;
$$;;
