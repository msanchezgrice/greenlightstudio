create table if not exists public.github_connections (
  id uuid primary key default gen_random_uuid(),
  clerk_id text not null unique,
  github_token text not null,
  github_username text,
  github_avatar_url text,
  github_id bigint,
  scopes text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.github_connections enable row level security;

create policy "Users can read own connections"
  on public.github_connections
  for select
  using (clerk_id = current_setting('request.jwt.claims', true)::json->>'sub');
