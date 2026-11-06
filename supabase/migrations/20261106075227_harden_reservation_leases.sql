-- Outlive the 300-second function plus any provider request already in flight.
create or replace function public.claim_calendar_write(p_user uuid,p_token uuid) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 insert into public.calendar_write_locks(user_id,lease_token,lease_until) values(p_user,p_token,now()+interval '10 minutes')
 on conflict(user_id) do update set lease_token=excluded.lease_token,lease_until=excluded.lease_until where public.calendar_write_locks.lease_until<now();
 return found;
end $$;
revoke all on function public.claim_calendar_write(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_calendar_write(uuid,uuid) to service_role;
