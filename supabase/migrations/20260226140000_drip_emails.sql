-- Drip / lifecycle email tracking (user-level, not project-scoped)
create table if not exists public.drip_email_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  email_type text not null check (email_type in (
    'welcome',
    'weekly_digest',
    'nudge_no_reviews',
    'nudge_no_signoffs',
    'phase0_ready'
  )),
  project_id uuid references public.projects(id) on delete set null,
  digest_week text,
  to_email text not null,
  subject text not null,
  resend_message_id text,
  status text not null default 'sent' check (status in ('sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

-- Deduplication: one welcome email per user
create unique index if not exists idx_drip_welcome_once
  on public.drip_email_log(user_id) where email_type = 'welcome';

-- Deduplication: one phase-0-ready email per project
create unique index if not exists idx_drip_phase0_ready_once
  on public.drip_email_log(user_id, project_id) where email_type = 'phase0_ready';

-- Deduplication: one digest per user per ISO week
create unique index if not exists idx_drip_digest_week_once
  on public.drip_email_log(user_id, digest_week) where email_type = 'weekly_digest';

-- Deduplication: one nudge of each type per user
create unique index if not exists idx_drip_nudge_reviews_once
  on public.drip_email_log(user_id) where email_type = 'nudge_no_reviews';

create unique index if not exists idx_drip_nudge_signoffs_once
  on public.drip_email_log(user_id) where email_type = 'nudge_no_signoffs';

-- Query indexes
create index if not exists idx_drip_email_user_type
  on public.drip_email_log(user_id, email_type);

create index if not exists idx_drip_email_created
  on public.drip_email_log(created_at desc);

-- RLS
alter table public.drip_email_log enable row level security;

drop policy if exists drip_email_log_select_own on public.drip_email_log;
create policy drip_email_log_select_own on public.drip_email_log
  for select using (
    user_id = (select u.id from public.users u where u.clerk_id = auth.jwt() ->> 'sub' limit 1)
  );
