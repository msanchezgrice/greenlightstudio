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
  on public.agent_memory(project_id, category, updated_at desc);;
