-- Unscheduled focus timers reuse canonical completion history; no external calendar writes.
create table public.focus_sessions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 task_id uuid not null, request_id uuid not null,
 status text not null default 'running' check(status in('running','paused','finished','discarded')),
 started_at timestamptz not null default now(), running_since timestamptz, elapsed_seconds integer not null default 0 check(elapsed_seconds>=0),
 actual_minutes integer check(actual_minutes between 1 and 1440), finish_task boolean not null default false, notes text not null default '' check(length(notes)<=2000), work_block_id uuid,
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(user_id,id), unique(user_id,request_id), foreign key(user_id,task_id) references public.tasks(user_id,id), foreign key(user_id,work_block_id) references public.work_blocks(user_id,id),
 check((status='running')=(running_since is not null)), check((status='finished')=(actual_minutes is not null))
);
create unique index focus_one_active on public.focus_sessions(user_id) where status in('running','paused');
create index focus_task_owner on public.focus_sessions(user_id,task_id);
create index focus_block_owner on public.focus_sessions(user_id,work_block_id) where work_block_id is not null;
alter table public.focus_sessions enable row level security;
revoke all on public.focus_sessions from public, anon, authenticated;
grant select on public.focus_sessions to authenticated;
grant all on public.focus_sessions to service_role;
create policy own_focus on public.focus_sessions for select to authenticated using(user_id=(select auth.uid()) and public.is_approved_user());
create trigger stamp_focus before update on public.focus_sessions for each row execute function public.stamp_record();
create trigger audit_focus after insert or update on public.focus_sessions for each row execute function public.audit_record();

create function public.change_focus_session(p_action text,p_session uuid,p_version integer,p_request uuid,p_task uuid,p_minutes integer,p_finish boolean,p_notes text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid(); s public.focus_sessions; t public.tasks; block uuid; result jsonb; seconds integer;
begin
 if owner is null or not public.is_approved_user() then raise exception 'Unauthorized' using errcode='42501';end if;
 if p_request is null or p_action is null or p_action not in('start','pause','resume','finish','discard') then raise exception 'Invalid action' using errcode='22023';end if;
 -- Serialize two tabs attempting to start a timer for the same owner.
 perform 1 from public.profiles where user_id=owner for update;
 if p_action='start' then
  select * into s from public.focus_sessions where user_id=owner and request_id=p_request;
  if found then
   if s.task_id is distinct from p_task then raise exception 'Request changed' using errcode='40001';end if;
   return to_jsonb(s);
  end if;
  if exists(select 1 from public.focus_sessions where user_id=owner and status in('running','paused')) then raise exception 'Another focus session is active' using errcode='40001';end if;
  select * into t from public.tasks where user_id=owner and id=p_task and deleted_at is null and status not in('completed','cancelled') and recurrence_rule_id is null for update;
  if not found then raise exception 'Task unavailable' using errcode='P0002';end if;
  insert into public.focus_sessions(user_id,task_id,request_id,running_since) values(owner,t.id,p_request,now()) returning * into s;
  return to_jsonb(s);
 end if;
 select * into s from public.focus_sessions where user_id=owner and id=p_session for update;
 if not found then raise exception 'Focus session unavailable' using errcode='P0002';end if;
 if p_action='finish' and s.status='finished' then
  if s.actual_minutes is distinct from p_minutes or s.finish_task is distinct from p_finish or s.notes is distinct from p_notes then raise exception 'Session already recorded with different details' using errcode='40001';end if;
  return to_jsonb(s);
 end if;
 if p_version is null or s.version<>p_version or s.status not in('running','paused') then raise exception 'Session changed; refresh first' using errcode='40001';end if;
 seconds:=s.elapsed_seconds+case when s.running_since is null then 0 else greatest(0,floor(extract(epoch from(now()-s.running_since)))::integer) end;
 if p_action='pause' and s.status='running' then
  update public.focus_sessions set status='paused',running_since=null,elapsed_seconds=seconds where id=s.id returning * into s;
 elsif p_action='resume' and s.status='paused' then
  update public.focus_sessions set status='running',running_since=now() where id=s.id returning * into s;
 elsif p_action='discard' then
  update public.focus_sessions set status='discarded',running_since=null,elapsed_seconds=seconds where id=s.id returning * into s;
 elsif p_action='finish' then
  if p_minutes is null or p_minutes not between 1 and 1440 or p_finish is null or p_notes is null or length(p_notes)>2000 then raise exception 'Confirm your actual work details' using errcode='22023';end if;
  insert into public.work_blocks(user_id,task_id,start_at,end_at,status,policy_version) values(owner,s.task_id,s.started_at,greatest(now(),s.started_at+interval '1 second'),'planned',1) returning id into block;
  result:=public.complete_work_session(block,1,s.id,p_minutes,null,null,p_finish,false,p_notes);
  update public.focus_sessions set status='finished',running_since=null,elapsed_seconds=seconds,actual_minutes=p_minutes,finish_task=p_finish,notes=p_notes,work_block_id=block where id=s.id returning * into s;
 else raise exception 'Invalid session transition' using errcode='22023';
 end if;
 return to_jsonb(s);
end;$$;
revoke all on function public.change_focus_session(text,uuid,integer,uuid,uuid,integer,boolean,text) from public,anon;
grant execute on function public.change_focus_session(text,uuid,integer,uuid,uuid,integer,boolean,text) to authenticated;
