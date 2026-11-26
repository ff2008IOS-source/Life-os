-- What Life OS changed on its own because of a course update or email
-- (a moved assessment date, a task for a dated deadline), kept so the owner
-- can see it and undo it.
alter table public.course_messages
  add column applied jsonb,
  add column applied_at timestamptz,
  add column applied_dismissed_at timestamptz;

-- The server role applies these changes (already granted in production).
grant select, update on public.assessments to service_role;
grant select, insert, update on public.tasks to service_role;

-- Rollback:
--   alter table public.course_messages
--     drop column applied, drop column applied_at, drop column applied_dismissed_at;
