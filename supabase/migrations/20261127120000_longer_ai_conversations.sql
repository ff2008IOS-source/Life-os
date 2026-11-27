-- A weekly review is a sit-down conversation: allow up to 100 messages a
-- day (was 20). Rollback: restore the 1..20 check after lowering values.
alter table public.assistant_settings
  drop constraint if exists assistant_settings_daily_limit_check;
alter table public.assistant_settings
  add constraint assistant_settings_daily_limit_check
  check (daily_limit >= 1 and daily_limit <= 100);
