create extension if not exists "pgcrypto";

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_clerk_id text not null,
  name text not null,
  domain text,
  idea_description text not null,
  repo_url text,
  phase int not null default 0,
  runtime_mode text not null check (runtime_mode in ('shared', 'attached')),
  permissions jsonb not null,
  night_shift boolean not null default true,
  focus_areas text[] not null default '{}',
  scan_results jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.phase_packets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  phase int not null,
  packet jsonb not null,
  confidence int not null check (confidence between 0 and 100),
  synopsis jsonb not null,
  created_at timestamptz not null default now(),
  unique(project_id, phase)
);

create table if not exists public.approval_queue (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  phase int not null,
  title text not null,
  description text not null,
  risk text not null check (risk in ('high', 'medium', 'low')),
  action_type text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'revised')),
  version int not null default 1,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.task_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  step text not null,
  status text not null,
  detail text,
  created_at timestamptz not null default now()
);

alter table public.projects enable row level security;
alter table public.phase_packets enable row level security;
alter table public.approval_queue enable row level security;
alter table public.task_log enable row level security;

create policy projects_select_own on public.projects
  for select using (owner_clerk_id = auth.jwt() ->> 'sub');
create policy projects_insert_own on public.projects
  for insert with check (owner_clerk_id = auth.jwt() ->> 'sub');
create policy projects_update_own on public.projects
  for update using (owner_clerk_id = auth.jwt() ->> 'sub');

create policy packets_select_own on public.phase_packets
  for select using (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub')
  );
create policy queue_select_own on public.approval_queue
  for select using (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub')
  );
create policy tasklog_select_own on public.task_log
  for select using (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub')
  );
