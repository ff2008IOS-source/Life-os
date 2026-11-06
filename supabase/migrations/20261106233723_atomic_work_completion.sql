-- Additive development migration. Do not apply to production before release approval.
alter table public.tasks add column course_id uuid,add column topic_id uuid;
alter table public.tasks add foreign key(user_id,course_id) references public.courses(user_id,id),add foreign key(user_id,topic_id) references public.study_topics(user_id,id),add foreign key(user_id,course_id,topic_id) references public.study_topics(user_id,course_id,id),add check(topic_id is null or course_id is not null);
create index tasks_course_owner on public.tasks(user_id,course_id) where course_id is not null;
alter table public.work_blocks add column actual_minutes integer check(actual_minutes>0);
create table public.work_completions (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,work_block_id uuid not null,task_id uuid not null,course_id uuid,topic_id uuid,
 actual_minutes integer not null check(actual_minutes between 1 and 1440),actual_start_at timestamptz,actual_end_at timestamptz,
 finish_task boolean not null default false,task_completed boolean not null default false,practiced_topic boolean not null default false,notes text not null default '' check(length(notes)<=2000),reported_at timestamptz not null default now(),
 unique(user_id,id),unique(user_id,course_id,id),unique(user_id,request_id),unique(user_id,work_block_id),
 foreign key(user_id,work_block_id) references public.work_blocks(user_id,id),foreign key(user_id,task_id) references public.tasks(user_id,id),foreign key(user_id,course_id) references public.courses(user_id,id),foreign key(user_id,course_id,topic_id) references public.study_topics(user_id,course_id,id),
 check((actual_start_at is null and actual_end_at is null) or (actual_start_at is not null and actual_end_at is not null and actual_end_at>actual_start_at)),check(not practiced_topic or topic_id is not null)
);
alter table public.work_completions enable row level security;
revoke all on public.work_completions from public,anon,authenticated;
grant select on public.work_completions to authenticated;
grant all on public.work_completions to service_role;
create policy own_records on public.work_completions for select to authenticated using(user_id=auth.uid() and public.is_approved_user());
create index work_completions_reported on public.work_completions(user_id,reported_at);
create trigger audit after insert or update or delete on public.work_completions for each row execute function public.audit_record();
create trigger audit after insert or update or delete on public.work_blocks for each row execute function public.audit_record();

alter table public.study_sessions alter column start_at drop not null,alter column end_at drop not null;
alter table public.study_sessions add column completion_id uuid,add unique(user_id,completion_id),add foreign key(user_id,course_id,completion_id) references public.work_completions(user_id,course_id,id),add check((start_at is null and end_at is null) or(start_at is not null and end_at is not null and end_at>start_at));
create trigger audit after insert or update or delete on public.study_sessions for each row execute function public.audit_record();
-- Completion-backed study history cannot be rewritten through ordinary CRUD.
drop policy own_records on public.study_sessions;
create policy own_read on public.study_sessions for select to authenticated using(user_id=auth.uid() and public.is_approved_user());
create policy own_insert on public.study_sessions for insert to authenticated with check(user_id=auth.uid() and public.is_approved_user() and completion_id is null);
create policy own_update on public.study_sessions for update to authenticated using(user_id=auth.uid() and public.is_approved_user()) with check(user_id=auth.uid() and public.is_approved_user());
create policy own_delete on public.study_sessions for delete to authenticated using(user_id=auth.uid() and public.is_approved_user() and completion_id is null);
create function public.protect_completed_study() returns trigger language plpgsql set search_path='' as $$begin
 if old.completion_id is not null and (to_jsonb(new)-array['notes','updated_at','version']) is distinct from (to_jsonb(old)-array['notes','updated_at','version']) then raise exception 'Recorded completion details are immutable; only notes can be edited' using errcode='42501';end if;return new;end$$;
create trigger protect_completed_study before update on public.study_sessions for each row execute function public.protect_completed_study();
create function public.protect_logged_effort() returns trigger language plpgsql set search_path='' as $$begin
 if coalesce(new.actual_minutes,0)<(select coalesce(sum(actual_minutes),0) from public.work_completions where user_id=new.user_id and task_id=new.id) then raise exception 'Actual effort cannot be reduced below recorded session effort' using errcode='23514';end if;return new;end$$;
create trigger protect_logged_effort before update on public.tasks for each row execute function public.protect_logged_effort();

-- Narrow ownership-checked mutation: no provider calls and no caller-supplied user ID.
create function public.complete_work_session(p_block uuid,p_version integer,p_request uuid,p_minutes integer,p_start timestamptz,p_end timestamptz,p_finish boolean,p_practiced boolean,p_notes text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid();b public.work_blocks;t public.tasks;previous public.work_completions;completion uuid;did_complete boolean;
begin
 if owner is null or not public.is_approved_user() then raise exception 'Unauthorized' using errcode='42501';end if;
 if p_request is null or p_version is null or p_version<1 or p_minutes is null or p_minutes not between 1 and 1440 or p_finish is null or p_practiced is null or p_notes is null or length(p_notes)>2000 then raise exception 'Invalid completion input' using errcode='22023';end if;
 if (p_start is null)<>(p_end is null) or (p_start is not null and(p_end<=p_start or p_end>now()+interval '5 minutes' or p_minutes>ceil(extract(epoch from(p_end-p_start))/60))) then raise exception 'Actual timestamps and effort are inconsistent' using errcode='22023';end if;
 -- Serialize completion with apply/undo lease acquisition without holding a transaction across provider I/O.
 insert into public.calendar_write_locks(user_id,lease_token,lease_until) values(owner,gen_random_uuid(),now()-interval '1 second') on conflict(user_id) do nothing;
 perform 1 from public.calendar_write_locks where user_id=owner for update;
 if exists(select 1 from public.calendar_write_locks where user_id=owner and lease_until>=now()) then raise exception 'Calendar changes are running; retry completion after they finish' using errcode='40001';end if;
 select * into b from public.work_blocks where user_id=owner and id=p_block for update;
 if not found then raise exception 'Session not found' using errcode='P0002';end if;
 select * into previous from public.work_completions where user_id=owner and(request_id=p_request or work_block_id=p_block) limit 1;
 if found then
  if previous.work_block_id<>p_block or previous.actual_minutes<>p_minutes or previous.actual_start_at is distinct from p_start or previous.actual_end_at is distinct from p_end or previous.finish_task<>p_finish or previous.practiced_topic<>p_practiced or previous.notes<>p_notes then raise exception 'Completion already recorded with different values' using errcode='40001';end if;
  return jsonb_build_object('id',previous.id,'replayed',true);
 end if;
 if b.version<>p_version then raise exception 'Session changed; refresh first' using errcode='40001';end if;
 if b.status<>'planned' or b.occurrence_id is not null then raise exception 'Only planned nonrecurring sessions can be completed here' using errcode='22023';end if;
 select * into t from public.tasks where user_id=owner and id=b.task_id for update;
 if not found or t.deleted_at is not null or t.status='cancelled' or t.recurrence_rule_id is not null then raise exception 'Task is unavailable for this completion' using errcode='22023';end if;
 if p_practiced and t.topic_id is null then raise exception 'Link a study topic before recording topic practice' using errcode='22023';end if;
 did_complete:=p_finish and t.status<>'completed';
 insert into public.work_completions(user_id,request_id,work_block_id,task_id,course_id,topic_id,actual_minutes,actual_start_at,actual_end_at,finish_task,task_completed,practiced_topic,notes)
 values(owner,p_request,p_block,t.id,t.course_id,t.topic_id,p_minutes,p_start,p_end,p_finish,did_complete,p_practiced,p_notes) returning id into completion;
 update public.work_blocks set status='completed',actual_minutes=p_minutes where user_id=owner and id=p_block;
 update public.tasks set actual_minutes=coalesce(actual_minutes,0)+p_minutes,status=case when p_finish then 'completed' when status in ('inbox','planned') then 'in_progress' else status end,completed_at=case when p_finish then coalesce(completed_at,now()) else completed_at end where user_id=owner and id=t.id;
 if t.course_id is not null then
  insert into public.study_sessions(user_id,course_id,topic_id,task_id,start_at,end_at,actual_minutes,notes,completion_id) values(owner,t.course_id,t.topic_id,t.id,p_start,p_end,p_minutes,p_notes,completion);
 end if;
 -- Remaining external reservations are preserved. Cancellation/replanning is a separate authorized operation.
 return jsonb_build_object('id',completion,'replayed',false);
end$$;
revoke all on function public.complete_work_session(uuid,integer,uuid,integer,timestamptz,timestamptz,boolean,boolean,text) from public,anon;
grant execute on function public.complete_work_session(uuid,integer,uuid,integer,timestamptz,timestamptz,boolean,boolean,text) to authenticated;
create function public.work_progress_summary(p_start timestamptz,p_end timestamptz) returns jsonb language plpgsql security invoker set search_path='' as $$begin
 if p_end<=p_start or p_end-p_start>interval '367 days' then raise exception 'Invalid report period' using errcode='22023';end if;
 return (select jsonb_build_object('session_count',count(*),'actual_minutes',coalesce(sum(actual_minutes),0),'academic_minutes',coalesce(sum(actual_minutes) filter(where course_id is not null),0),'tasks_completed',count(distinct task_id) filter(where task_completed),'topic_practice_sessions',count(*) filter(where practiced_topic)) from public.work_completions where user_id=auth.uid() and reported_at>=p_start and reported_at<p_end);
end$$;
revoke all on function public.work_progress_summary(timestamptz,timestamptz) from public,anon;
grant execute on function public.work_progress_summary(timestamptz,timestamptz) to authenticated;

create function public.protect_completed_block() returns trigger language plpgsql set search_path='' as $$begin
 if exists(select 1 from public.work_completions where user_id=old.user_id and work_block_id=old.id) and (new.status<>'completed' or new.actual_minutes is distinct from old.actual_minutes) and old.status='completed' then raise exception 'Recorded work completion cannot be changed by reservation edits' using errcode='23514';end if;return new;end$$;
create trigger protect_completed_block before update on public.work_blocks for each row execute function public.protect_completed_block();
