-- A background read may confirm the same move before the outbox response returns.
create or replace function public.finish_managed_calendar_move(p_user uuid,p_operation text,p_lease uuid,p_event jsonb)returns void language plpgsql security invoker set search_path=''as $$
declare j public.integration_jobs;b public.work_blocks;result text;
begin
 if not exists(select 1 from private.approved_users where user_id=p_user)or not exists(select 1 from public.calendar_write_locks where user_id=p_user and lease_token=p_lease and lease_until>now())then raise exception 'Calendar lease required'using errcode='42501';end if;
 select * into j from public.integration_jobs where user_id=p_user and job_type='calendar_reschedule'and idempotency_key=p_operation for update;
 if not found then raise exception 'Calendar move missing'using errcode='42501';end if;
 if j.status='completed'then return;end if;
 if j.status<>'running' or p_event#>>'{extendedProperties,private,lifeos_operation}'is distinct from p_operation or p_event->>'id'is distinct from j.payload#>>'{intent,event_id}' or (p_event#>>'{start,dateTime}')::timestamptz is distinct from (j.payload#>>'{intent,start_at}')::timestamptz or (p_event#>>'{end,dateTime}')::timestamptz is distinct from(j.payload#>>'{intent,end_at}')::timestamptz then raise exception 'Provider confirmation mismatch'using errcode='40001';end if;
 select * into b from public.work_blocks where user_id=p_user and id=(j.payload->>'block_id')::uuid for update;
 if not found or b.status<>'planned' or b.provider_event_id is distinct from j.payload#>>'{intent,event_id}'then raise exception 'Work session changed; review required'using errcode='40001';end if;
 if b.version<>(j.payload->>'version')::integer and(b.start_at is distinct from(j.payload#>>'{intent,start_at}')::timestamptz or b.end_at is distinct from(j.payload#>>'{intent,end_at}')::timestamptz)then raise exception 'Work session changed; review required'using errcode='40001';end if;
 result:=public.reconcile_managed_calendar(p_user,b.id,b.version,p_lease,p_event,null,true);
 if result<>'synced'then raise exception 'Provider confirmation needs review'using errcode='40001';end if;
 update public.integration_jobs set status='completed',last_error=null where id=j.id and user_id=p_user;
end$$;
revoke all on function public.finish_managed_calendar_move(uuid,text,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.finish_managed_calendar_move(uuid,text,uuid,jsonb)to service_role;
