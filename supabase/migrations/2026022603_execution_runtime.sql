create table if not exists public.project_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  phase integer,
  kind text not null check (kind in ('upload','landing_html','email_template','ads_creative','release_note','packet_export')),
  storage_bucket text not null default 'project-assets',
  storage_path text not null,
  filename text not null,
  mime_type text,
  size_bytes bigint,
  status text not null default 'pending' check (status in ('pending','uploaded','failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  unique(project_id, storage_path)
);

create table if not exists public.action_executions (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references public.approval_queue(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  action_type text not null,
  status text not null check (status in ('running','completed','failed')),
  detail text,
  provider_response jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.project_deployments (
  project_id uuid primary key references public.projects(id) on delete cascade,
  phase integer not null default 1,
  status text not null check (status in ('ready','failed')),
  html_content text not null,
  metadata jsonb not null default '{}'::jsonb,
  deployed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  approval_id uuid references public.approval_queue(id) on delete set null,
  to_email text not null,
  subject text not null,
  html_body text not null,
  scheduled_for timestamptz not null,
  status text not null default 'queued' check (status in ('queued','sent','failed')),
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.projects add column if not exists deploy_status text not null default 'idle' check (deploy_status in ('idle','ready','failed'));
alter table public.projects add column if not exists live_url text;

create index if not exists idx_project_assets_project_created on public.project_assets(project_id, created_at desc);
create index if not exists idx_action_executions_project_created on public.action_executions(project_id, created_at desc);
create index if not exists idx_email_jobs_project_scheduled on public.email_jobs(project_id, scheduled_for);
create index if not exists idx_email_jobs_status_scheduled on public.email_jobs(status, scheduled_for);

alter table public.project_assets enable row level security;
alter table public.action_executions enable row level security;
alter table public.project_deployments enable row level security;
alter table public.email_jobs enable row level security;

drop policy if exists project_assets_select_own on public.project_assets;
create policy project_assets_select_own on public.project_assets
  for select using (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub')
  );

drop policy if exists action_executions_select_own on public.action_executions;
create policy action_executions_select_own on public.action_executions
  for select using (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub')
  );

drop policy if exists project_deployments_select_own on public.project_deployments;
create policy project_deployments_select_own on public.project_deployments
  for select using (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub')
  );

drop policy if exists email_jobs_select_own on public.email_jobs;
create policy email_jobs_select_own on public.email_jobs
  for select using (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub')
  );

insert into storage.buckets (id, name, public)
values ('project-assets', 'project-assets', false)
on conflict (id) do nothing;
