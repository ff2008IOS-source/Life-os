-- Reuse the existing owner-protected ledger. Do not rewrite or delete activity.
-- A pending/running decision represents one block, even if two source refreshes race.
create unique index active_work_block_decision
  on public.integration_jobs(user_id, (payload->>'block_id'))
  where job_type in ('work_replan_proposal','missed_block_decision')
    and status in ('pending','running');

-- Explicit backend privileges for the bounded owner-scoped planning worker.
-- No browser-role grants or ownership policies are changed.
grant select on public.tasks, public.life_areas, public.task_dependencies,
  public.calendars, public.calendar_connections, public.calendar_events,
  public.assessments, public.scheduling_automation to service_role;
grant select, update on public.work_blocks to service_role;
grant select, insert, update on public.integration_jobs to service_role;
