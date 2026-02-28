create or replace function public.complete_agent_job(p_job_id uuid, p_status text, p_error text default null)
returns void
language plpgsql
as $$
begin
  update public.agent_jobs
  set status = p_status,
      last_error = p_error,
      completed_at = case
        when p_status in ('completed', 'failed', 'canceled') then coalesce(completed_at, now())
        else completed_at
      end
  where id = p_job_id;
end;
$$;
