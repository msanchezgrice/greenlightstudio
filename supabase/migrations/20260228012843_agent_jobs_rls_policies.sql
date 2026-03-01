-- RLS
alter table public.agent_jobs enable row level security;
alter table public.agent_job_events enable row level security;
alter table public.agent_memory enable row level security;

drop policy if exists agent_jobs_select_own on public.agent_jobs;
create policy agent_jobs_select_own on public.agent_jobs
  for select using (
    exists (select 1 from public.projects p
            where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub')
  );

drop policy if exists agent_job_events_select_own on public.agent_job_events;
create policy agent_job_events_select_own on public.agent_job_events
  for select using (
    exists (select 1 from public.projects p
            where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub')
  );

drop policy if exists agent_memory_select_own on public.agent_memory;
create policy agent_memory_select_own on public.agent_memory
  for select using (
    exists (select 1 from public.projects p
            where p.id = project_id and p.owner_clerk_id = auth.jwt() ->> 'sub')
  );;
