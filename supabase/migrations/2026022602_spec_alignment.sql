create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  clerk_id text unique not null,
  email text,
  created_at timestamptz not null default now()
);

alter table public.projects add column if not exists user_id uuid references public.users(id) on delete set null;
alter table public.projects add column if not exists wizard_state jsonb not null default '{}'::jsonb;
alter table public.projects add column if not exists repo_summary jsonb;
alter table public.projects add column if not exists brand_kit jsonb;

alter table public.phase_packets add column if not exists packet_data jsonb;
alter table public.phase_packets add column if not exists confidence_score integer;
alter table public.phase_packets add column if not exists ceo_recommendation text;
alter table public.phase_packets add column if not exists reasoning_synopsis jsonb;
alter table public.phase_packets add column if not exists deliverables jsonb;

update public.phase_packets
set
  packet_data = coalesce(packet_data, packet),
  confidence_score = coalesce(confidence_score, confidence),
  reasoning_synopsis = coalesce(reasoning_synopsis, synopsis)
where packet_data is null or confidence_score is null or reasoning_synopsis is null;

alter table public.approval_queue add column if not exists packet_id uuid references public.phase_packets(id) on delete set null;
alter table public.approval_queue add column if not exists type text;
alter table public.approval_queue add column if not exists risk_level text;
alter table public.approval_queue add column if not exists agent_source text;
alter table public.approval_queue add column if not exists resolved_at timestamptz;
alter table public.approval_queue add column if not exists resolved_by uuid references public.users(id) on delete set null;

update public.approval_queue
set
  type = coalesce(type, action_type),
  risk_level = coalesce(risk_level, risk),
  resolved_at = case when status = 'pending' then resolved_at else coalesce(resolved_at, decided_at) end;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  agent text not null,
  description text not null,
  status text not null check (status in ('queued', 'running', 'completed', 'failed')),
  detail text,
  reasoning_synopsis jsonb,
  execution_log text,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.domain_scan_cache (
  domain text primary key,
  result jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_domain_scan_cache_expires_at on public.domain_scan_cache(expires_at);
create index if not exists idx_tasks_project_created_at on public.tasks(project_id, created_at desc);

alter table public.users enable row level security;
alter table public.tasks enable row level security;

drop policy if exists users_select_own on public.users;
create policy users_select_own on public.users
  for select using (clerk_id = auth.jwt() ->> 'sub');

drop policy if exists users_insert_own on public.users;
create policy users_insert_own on public.users
  for insert with check (clerk_id = auth.jwt() ->> 'sub');

drop policy if exists users_update_own on public.users;
create policy users_update_own on public.users
  for update using (clerk_id = auth.jwt() ->> 'sub');

drop policy if exists tasks_select_own on public.tasks;
create policy tasks_select_own on public.tasks
  for select using (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub')
  );
