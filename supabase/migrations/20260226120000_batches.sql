-- Batches table for bulk import workflows
create table if not exists public.batches (
  id uuid primary key default gen_random_uuid(),
  owner_clerk_id text not null,
  name text not null default 'Untitled Batch',
  status text not null default 'draft' check (status in ('draft','running','completed','failed')),
  domain_count integer not null default 0,
  scan_options jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add batch_id to projects (nullable FK)
alter table public.projects add column if not exists batch_id uuid references public.batches(id);

-- RLS
alter table public.batches enable row level security;

create policy "Users can view own batches"
  on public.batches for select
  using (owner_clerk_id = current_setting('request.jwt.claims', true)::jsonb ->> 'sub');

create policy "Users can insert own batches"
  on public.batches for insert
  with check (owner_clerk_id = current_setting('request.jwt.claims', true)::jsonb ->> 'sub');

create policy "Users can update own batches"
  on public.batches for update
  using (owner_clerk_id = current_setting('request.jwt.claims', true)::jsonb ->> 'sub');

-- Service role bypass
create policy "Service role full access to batches"
  on public.batches for all
  using (current_setting('role', true) = 'service_role');
