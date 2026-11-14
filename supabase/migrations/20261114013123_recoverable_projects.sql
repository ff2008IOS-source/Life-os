-- Additive, recoverable project deletion. No linked work or provider records are removed.
alter table public.projects add column if not exists deleted_at timestamptz;
comment on column public.projects.deleted_at is 'Recoverable removal from everyday views; linked tasks, history and source identities remain intact.';
