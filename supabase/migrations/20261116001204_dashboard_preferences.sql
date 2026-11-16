-- Additive, owner-scoped dashboard preferences; existing task and provider records are untouched.
create table public.dashboard_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 settings jsonb not null check(jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 16384),
 version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.dashboard_preferences enable row level security;
revoke all on public.dashboard_preferences from public, anon, authenticated;
grant all on public.dashboard_preferences to service_role;
grant select, insert, update on public.dashboard_preferences to authenticated;
create policy own_dashboard on public.dashboard_preferences for all to authenticated
 using (user_id = (select auth.uid()) and public.is_approved_user())
 with check (user_id = (select auth.uid()) and public.is_approved_user());
create trigger stamp_dashboard before update on public.dashboard_preferences for each row execute function public.stamp_record();
