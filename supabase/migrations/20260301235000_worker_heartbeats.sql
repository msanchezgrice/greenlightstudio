create table if not exists public.worker_heartbeats (
  worker_id text primary key,
  service_name text not null default 'greenlight-worker',
  status text not null default 'running' check (status in ('running', 'draining', 'stopped', 'error')),
  started_at timestamptz,
  last_seen_at timestamptz not null default now(),
  jobs_processed bigint not null default 0,
  consecutive_poll_errors int not null default 0,
  rss_mb numeric(10,2),
  heap_used_mb numeric(10,2),
  heap_total_mb numeric(10,2),
  external_mb numeric(10,2),
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_worker_heartbeats_last_seen
  on public.worker_heartbeats(last_seen_at desc);

create index if not exists idx_worker_heartbeats_status
  on public.worker_heartbeats(status, last_seen_at desc);

alter table public.worker_heartbeats enable row level security;
