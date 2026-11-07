-- Provider edits are reconciled independently of the bounded availability cache.
create table public.managed_calendar_state(
 user_id uuid not null references auth.users(id)on delete cascade,
 block_id uuid primary key,task_id uuid not null,
 state text not null check(state in('synced','conflict','externally_cancelled')),
 planning_hold boolean not null default false,
 reason text,last_provider_etag text,provider_snapshot jsonb not null default '{}',
 checked_at timestamptz not null default now(),
 foreign key(user_id,block_id)references public.work_blocks(user_id,id)on delete cascade,
 foreign key(user_id,task_id)references public.tasks(user_id,id)on delete cascade
);
alter table public.managed_calendar_state enable row level security;
grant select on public.managed_calendar_state to authenticated;
revoke all on public.managed_calendar_state from anon;
create policy managed_calendar_owner_read on public.managed_calendar_state for select to authenticated using(user_id=auth.uid()and public.is_approved_user());
create index managed_calendar_held_tasks on public.managed_calendar_state(user_id,task_id)where planning_hold;
grant all on public.managed_calendar_state to service_role;
create function public.reconcile_managed_calendar(p_user uuid,p_block uuid,p_version integer,p_lease uuid,p_event jsonb,p_reason text,p_accept boolean default false)returns text language plpgsql security invoker set search_path='' as $$
declare b public.work_blocks;c public.calendars;gone boolean;s timestamptz;e timestamptz;st text;reason text:=p_reason;
begin
 if not exists(select 1 from private.approved_users where user_id=p_user)or not exists(select 1 from public.calendar_write_locks where user_id=p_user and lease_token=p_lease and lease_until>now())then raise exception 'Calendar lease required' using errcode='42501';end if;
 select * into b from public.work_blocks where user_id=p_user and id=p_block for update;
 if not found or b.version<>p_version or b.status<>'planned' then raise exception 'Work session changed' using errcode='40001';end if;
 select x.* into c from public.calendars x join public.calendar_events y on y.user_id=x.user_id and y.calendar_id=x.id where y.user_id=p_user and y.id=b.calendar_event_id;
 if c.id is null or not c.is_life_os_owned or not c.write_enabled then raise exception 'Not a managed calendar' using errcode='42501';end if;
 gone:=p_event->>'status'='cancelled';
 if p_event->>'id' is distinct from b.provider_event_id then raise exception 'Provider identity mismatch' using errcode='22023';end if;
 if not gone and (p_event#>>'{extendedProperties,private,lifeos_run}' is distinct from b.run_id::text or p_event#>>'{extendedProperties,private,lifeos_task}' is distinct from b.task_id::text)then reason:='The event ownership markers changed. Review it in Google Calendar.';p_accept:=false;end if;
 if gone then
  st:='externally_cancelled';reason:='Deleted in Google Calendar. Automatic planning for this task is held until you resume it.';
  update public.work_blocks set status='cancelled',provider_etag=p_event->>'etag'where user_id=p_user and id=b.id;
  update public.calendar_events set event_status='cancelled'where user_id=p_user and id=b.calendar_event_id;
 elsif reason is null or p_accept then
  s:=(p_event#>>'{start,dateTime}')::timestamptz;e:=(p_event#>>'{end,dateTime}')::timestamptz;
  if s is null or e is null or e<=s or p_event?'recurringEventId' or p_event?'recurrence' or nullif(p_event->>'etag','')is null then raise exception 'Unsupported managed event' using errcode='22023';end if;
  st:='synced';reason:=null;
  update public.work_blocks set start_at=s,end_at=e,provider_etag=p_event->>'etag',flexibility='fixed'where user_id=p_user and id=b.id;
  update public.calendar_events set start_at=s,end_at=e,all_day_start=null,all_day_end=null,event_status=coalesce(p_event->>'status','confirmed'),etag=p_event->>'etag',provider_updated_at=nullif(p_event->>'updated','')::timestamptz where user_id=p_user and id=b.calendar_event_id;
 else st:='conflict';end if;
 insert into public.managed_calendar_state(user_id,block_id,task_id,state,planning_hold,reason,last_provider_etag,provider_snapshot)values(p_user,b.id,b.task_id,st,st<>'synced',left(reason,500),p_event->>'etag',p_event)
 on conflict(block_id)do update set state=excluded.state,planning_hold=excluded.planning_hold,reason=excluded.reason,last_provider_etag=excluded.last_provider_etag,provider_snapshot=excluded.provider_snapshot,checked_at=now();
 return st;
end$$;
revoke all on function public.reconcile_managed_calendar(uuid,uuid,integer,uuid,jsonb,text,boolean)from public,anon,authenticated;
grant execute on function public.reconcile_managed_calendar(uuid,uuid,integer,uuid,jsonb,text,boolean)to service_role;
-- Provider confirmation and native session state commit atomically; an unknown
-- RPC response can be retried by the durable operation key.
create function public.finish_managed_calendar_move(p_user uuid,p_operation text,p_lease uuid,p_event jsonb)returns void language plpgsql security invoker set search_path=''as $$
declare j public.integration_jobs;result text;
begin
 select * into j from public.integration_jobs where user_id=p_user and job_type='calendar_reschedule'and idempotency_key=p_operation for update;
 if not found then raise exception 'Calendar move missing'using errcode='42501';end if;
 if j.status='completed'then return;end if;
 if j.status<>'running' or p_event#>>'{extendedProperties,private,lifeos_operation}'is distinct from p_operation or p_event->>'id'is distinct from j.payload#>>'{intent,event_id}' or (p_event#>>'{start,dateTime}')::timestamptz is distinct from (j.payload#>>'{intent,start_at}')::timestamptz or (p_event#>>'{end,dateTime}')::timestamptz is distinct from(j.payload#>>'{intent,end_at}')::timestamptz then raise exception 'Provider confirmation mismatch'using errcode='40001';end if;
 result:=public.reconcile_managed_calendar(p_user,(j.payload->>'block_id')::uuid,(j.payload->>'version')::integer,p_lease,p_event,null,true);
 if result<>'synced'then raise exception 'Provider confirmation needs review'using errcode='40001';end if;
 update public.integration_jobs set status='completed',last_error=null where id=j.id and user_id=p_user;
end$$;
revoke all on function public.finish_managed_calendar_move(uuid,text,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.finish_managed_calendar_move(uuid,text,uuid,jsonb)to service_role;
