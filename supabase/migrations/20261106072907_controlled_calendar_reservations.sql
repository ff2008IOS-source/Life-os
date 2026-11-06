-- Only the application server can enroll a dedicated calendar or change reservations.
create unique index one_dedicated_calendar on public.calendars(user_id) where is_life_os_owned;
alter table public.scheduling_runs add column operation_lease_until timestamptz;
alter table public.work_blocks add column run_id uuid, add column provider_event_id text, add column provider_etag text;
alter table public.work_blocks add foreign key(user_id,run_id) references public.scheduling_runs(user_id,id);
create unique index reserved_provider_event on public.work_blocks(user_id,provider_event_id);
create table public.calendar_write_locks (
 user_id uuid primary key references auth.users(id) on delete cascade,
 lease_token uuid not null, lease_until timestamptz not null
);
alter table public.calendar_write_locks enable row level security;
revoke all on public.calendar_write_locks from public,anon,authenticated;
grant all on public.calendar_write_locks to service_role;
create function public.claim_calendar_write(p_user uuid,p_token uuid) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 insert into public.calendar_write_locks(user_id,lease_token,lease_until) values(p_user,p_token,now()+interval '5 minutes')
 on conflict(user_id) do update set lease_token=excluded.lease_token,lease_until=excluded.lease_until where public.calendar_write_locks.lease_until<now();
 return found;
end $$;
revoke all on function public.claim_calendar_write(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_calendar_write(uuid,uuid) to service_role;
