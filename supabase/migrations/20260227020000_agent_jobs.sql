-- Sentinel "system" project for non-project-scoped jobs (email, drip)
insert into public.projects (
  id, name, owner_clerk_id, phase, runtime_mode,
  idea_description, permissions, night_shift, focus_areas, wizard_state, deploy_status
)
values (
  '00000000-0000-0000-0000-000000000000',
  '__system__',
  'system',
  0,
  'shared',
  'System project for non-project-scoped background jobs',
  '{"repo_write": false, "deploy": false, "ads_enabled": false, "ads_budget_cap": 0, "email_send": false}'::jsonb,
  false,
  '{}'::text[],
  '{}'::jsonb,
  'idle'
)
on conflict (id) do nothing;

-- Agent Jobs queue
create table if not exists public.agent_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,

  job_type text not null,
  agent_key text not null,

  status text not null default 'queued'
    check (status in ('queued','running','completed','failed','canceled')),

  priority int not null default 0,
  payload jsonb not null default '{}'::jsonb,

  idempotency_key text not null,

  run_after timestamptz not null default now(),

  attempts int not null default 0,
  max_attempts int not null default 3,

  locked_at timestamptz,
  locked_by text,

  last_error text,

  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create unique index if not exists idx_agent_jobs_idempotency
  on public.agent_jobs(project_id, idempotency_key);

create index if not exists idx_agent_jobs_ready
  on public.agent_jobs(status, run_after, priority desc, created_at);

create index if not exists idx_agent_jobs_project
  on public.agent_jobs(project_id, created_at desc);

-- Agent Job Events (alive feed)
create table if not exists public.agent_job_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  job_id uuid not null references public.agent_jobs(id) on delete cascade,

  type text not null,
  message text,
  data jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists idx_agent_job_events_job_created
  on public.agent_job_events(job_id, created_at asc);

create index if not exists idx_agent_job_events_project_created
  on public.agent_job_events(project_id, created_at desc);

create index if not exists idx_agent_job_events_project_cursor
  on public.agent_job_events(project_id, created_at, id);

-- Agent Memory (persistent knowledge store)
create table if not exists public.agent_memory (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  category text not null,
  key text not null,
  value text not null,
  source_job_id uuid references public.agent_jobs(id) on delete set null,
  agent_key text not null,
  confidence float not null default 1.0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_agent_memory_project_key
  on public.agent_memory(project_id, category, key);

create index if not exists idx_agent_memory_project_category
  on public.agent_memory(project_id, category, updated_at desc);

-- Execution status on approvals to prevent double-run
alter table public.approval_queue
  add column if not exists execution_status text not null default 'idle'
    check (execution_status in ('idle','queued','running','completed','failed'));

alter table public.approval_queue
  add column if not exists execution_job_id uuid references public.agent_jobs(id) on delete set null;

-- Idempotent action executions per approval
create unique index if not exists idx_action_executions_unique_approval
  on public.action_executions(approval_id);

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

-- RPC: mark job completed/failed (only sets completed_at for 'completed' status)
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
$$;

-- RLS
alter table public.agent_jobs enable row level security;
alter table public.agent_job_events enable row level security;
alter table public.agent_memory enable row level security;

drop policy if exists agent_jobs_select_own on public.agent_jobs;
create policy agent_jobs_select_own on public.agent_jobs
  for select using (
    exists (select 1 from public.projects p
            where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub')
  );

drop policy if exists agent_job_events_select_own on public.agent_job_events;
create policy agent_job_events_select_own on public.agent_job_events
  for select using (
    exists (select 1 from public.projects p
            where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub')
  );

drop policy if exists agent_memory_select_own on public.agent_memory;
create policy agent_memory_select_own on public.agent_memory
  for select using (
    exists (select 1 from public.projects p
            where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub')
  );
