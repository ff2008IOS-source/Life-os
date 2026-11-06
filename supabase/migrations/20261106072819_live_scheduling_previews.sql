alter table public.scheduling_runs add column proposal jsonb not null default '{}', add column expires_at timestamptz;
