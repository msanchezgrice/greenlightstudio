create table if not exists public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text not null default 'landing_page',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (email)
);

create table if not exists public.packet_share_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  token text not null unique,
  created_by text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_packet_share_links_project_created on public.packet_share_links(project_id, created_at desc);

