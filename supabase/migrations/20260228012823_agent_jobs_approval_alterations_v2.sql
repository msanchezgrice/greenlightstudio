-- Execution status on approvals to prevent double-run
alter table public.approval_queue
  add column if not exists execution_status text not null default 'idle'
    check (execution_status in ('idle','queued','running','completed','failed'));

alter table public.approval_queue
  add column if not exists execution_job_id uuid references public.agent_jobs(id) on delete set null;

-- Clean up duplicate action_executions per approval before adding unique index
delete from public.action_executions
where id not in (
  select distinct on (approval_id) id
  from public.action_executions
  order by approval_id, created_at desc
);

-- Idempotent action executions per approval
create unique index if not exists idx_action_executions_unique_approval
  on public.action_executions(approval_id);;
