-- Add phase1_ready to drip_email_log check constraint
alter table public.drip_email_log
  drop constraint if exists drip_email_log_email_type_check;

alter table public.drip_email_log
  add constraint drip_email_log_email_type_check
  check (email_type in (
    'welcome',
    'weekly_digest',
    'nudge_no_reviews',
    'nudge_no_signoffs',
    'phase0_ready',
    'phase1_ready'
  ));

create unique index if not exists idx_drip_phase1_ready_once
  on public.drip_email_log(user_id, project_id) where email_type = 'phase1_ready';
