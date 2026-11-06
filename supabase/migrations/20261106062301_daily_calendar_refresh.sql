-- Per-connection opt-in for read-only daily sync; no calendar write permission.
alter table public.calendar_connections add column daily_sync_enabled boolean not null default false;
