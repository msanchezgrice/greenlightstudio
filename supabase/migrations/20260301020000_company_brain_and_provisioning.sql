-- Phase 1: Company brain + event ledger + integrations + recurring + KPI ingestion
-- Phase 2 foundation: post-payment runtime provisioning metadata/state

create table if not exists public.project_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  event_type text not null,
  message text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_events_project_created
  on public.project_events(project_id, created_at desc);

create index if not exists idx_project_events_project_type_created
  on public.project_events(project_id, event_type, created_at desc);

create table if not exists public.project_brain_documents (
  project_id uuid primary key references public.projects(id) on delete cascade,
  mission_markdown text not null,
  memory_markdown text not null,
  memory_version int not null default 1,
  last_event_id uuid references public.project_events(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_brain_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  trigger_event_id uuid references public.project_events(id) on delete set null,
  reason text not null check (reason in ('event_ingest','scheduled_refresh','manual')),
  input_event_count int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists idx_project_brain_updates_project_created
  on public.project_brain_updates(project_id, created_at desc);

create index if not exists idx_project_brain_updates_status_created
  on public.project_brain_updates(status, created_at);

create table if not exists public.project_integrations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  provider text not null check (provider in ('resend','meta','github','vercel','analytics','payments')),
  enabled boolean not null default true,
  config_encrypted text not null,
  config_masked jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, provider)
);

create index if not exists idx_project_integrations_project_provider
  on public.project_integrations(project_id, provider);

create table if not exists public.project_email_identities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  provider text not null default 'resend',
  reply_address text not null unique,
  status text not null default 'active' check (status in ('active','disabled')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_email_identities_reply
  on public.project_email_identities(reply_address);

create table if not exists public.inbound_email_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  email_identity_id uuid references public.project_email_identities(id) on delete set null,
  provider text not null,
  provider_message_id text,
  from_email text not null,
  to_email text not null,
  subject text,
  text_body text,
  html_body text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'received' check (status in ('received','processed','failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_inbound_email_provider_message
  on public.inbound_email_messages(provider, provider_message_id)
  where provider_message_id is not null;

create index if not exists idx_inbound_email_project_created
  on public.inbound_email_messages(project_id, created_at desc);

create table if not exists public.project_recurring_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_key text not null,
  cron_expr text not null,
  timezone text not null default 'UTC',
  job_type text not null,
  agent_key text not null,
  payload jsonb not null default '{}'::jsonb,
  priority int not null default 10,
  enabled boolean not null default true,
  next_run_at timestamptz not null default now(),
  last_run_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, task_key)
);

create index if not exists idx_project_recurring_tasks_due
  on public.project_recurring_tasks(enabled, next_run_at);

create index if not exists idx_project_recurring_tasks_project
  on public.project_recurring_tasks(project_id, created_at desc);

create table if not exists public.project_analytics_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source text not null default 'manual',
  event_type text not null default 'track',
  event_name text not null,
  value_numeric numeric,
  value_text text,
  currency text,
  properties jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_project_analytics_project_occurred
  on public.project_analytics_events(project_id, occurred_at desc);

create index if not exists idx_project_analytics_name_occurred
  on public.project_analytics_events(project_id, event_name, occurred_at desc);

create table if not exists public.project_payment_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  provider text not null,
  external_id text,
  event_type text not null,
  status text not null,
  amount_cents bigint not null default 0,
  currency text not null default 'USD',
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_project_payment_external
  on public.project_payment_events(project_id, provider, external_id, event_type)
  where external_id is not null;

create index if not exists idx_project_payment_project_occurred
  on public.project_payment_events(project_id, occurred_at desc);

-- Phase 2 runtime provisioning state
create table if not exists public.project_runtime_instances (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  status text not null default 'shared' check (status in ('shared','provisioning','dedicated','failed')),
  mode text not null default 'shared' check (mode in ('shared','provisioning','dedicated')),
  provider text,
  runtime_endpoint text,
  runtime_metadata jsonb not null default '{}'::jsonb,
  repo_ref text,
  db_ref text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_runtime_instances_status
  on public.project_runtime_instances(status, updated_at desc);

create table if not exists public.project_provisioning_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  runtime_instance_id uuid references public.project_runtime_instances(id) on delete set null,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  step text,
  attempts int not null default 0,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists idx_project_provisioning_jobs_project_created
  on public.project_provisioning_jobs(project_id, created_at desc);

create index if not exists idx_project_provisioning_jobs_status_created
  on public.project_provisioning_jobs(status, created_at);

create table if not exists public.project_runtime_secrets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  secret_key text not null,
  secret_ref text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, secret_key)
);

create index if not exists idx_project_runtime_secrets_project
  on public.project_runtime_secrets(project_id, created_at desc);

alter table public.project_events enable row level security;
alter table public.project_brain_documents enable row level security;
alter table public.project_brain_updates enable row level security;
alter table public.project_integrations enable row level security;
alter table public.project_email_identities enable row level security;
alter table public.inbound_email_messages enable row level security;
alter table public.project_recurring_tasks enable row level security;
alter table public.project_analytics_events enable row level security;
alter table public.project_payment_events enable row level security;
alter table public.project_runtime_instances enable row level security;
alter table public.project_provisioning_jobs enable row level security;
alter table public.project_runtime_secrets enable row level security;

drop policy if exists project_events_select_own on public.project_events;
create policy project_events_select_own on public.project_events
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub'
    )
  );

drop policy if exists project_brain_documents_select_own on public.project_brain_documents;
create policy project_brain_documents_select_own on public.project_brain_documents
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub'
    )
  );

drop policy if exists project_brain_updates_select_own on public.project_brain_updates;
create policy project_brain_updates_select_own on public.project_brain_updates
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub'
    )
  );

drop policy if exists project_integrations_select_own on public.project_integrations;
create policy project_integrations_select_own on public.project_integrations
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub'
    )
  );

drop policy if exists project_email_identities_select_own on public.project_email_identities;
create policy project_email_identities_select_own on public.project_email_identities
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub'
    )
  );

drop policy if exists inbound_email_messages_select_own on public.inbound_email_messages;
create policy inbound_email_messages_select_own on public.inbound_email_messages
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub'
    )
  );

drop policy if exists project_recurring_tasks_select_own on public.project_recurring_tasks;
create policy project_recurring_tasks_select_own on public.project_recurring_tasks
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub'
    )
  );

drop policy if exists project_analytics_events_select_own on public.project_analytics_events;
create policy project_analytics_events_select_own on public.project_analytics_events
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub'
    )
  );

drop policy if exists project_payment_events_select_own on public.project_payment_events;
create policy project_payment_events_select_own on public.project_payment_events
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub'
    )
  );

drop policy if exists project_runtime_instances_select_own on public.project_runtime_instances;
create policy project_runtime_instances_select_own on public.project_runtime_instances
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub'
    )
  );

drop policy if exists project_provisioning_jobs_select_own on public.project_provisioning_jobs;
create policy project_provisioning_jobs_select_own on public.project_provisioning_jobs
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub'
    )
  );

drop policy if exists project_runtime_secrets_select_own on public.project_runtime_secrets;
create policy project_runtime_secrets_select_own on public.project_runtime_secrets
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub'
    )
  );
