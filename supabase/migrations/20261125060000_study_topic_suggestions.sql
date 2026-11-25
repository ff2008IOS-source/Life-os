-- Topics found in course materials start as suggestions the owner approves.
-- Existing topics are 'active'. Reversible: drop the column and its index.
alter table public.study_topics
  add column suggestion_state text not null default 'active'
  check (suggestion_state in ('active','suggested','dismissed'));
create index study_topics_suggestions on public.study_topics(user_id, course_id, suggestion_state);
-- Rollback:
--   drop index if exists public.study_topics_suggestions;
--   alter table public.study_topics drop column if exists suggestion_state;
