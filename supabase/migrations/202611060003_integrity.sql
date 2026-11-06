-- Parent links also form graphs. Serialize per-user updates before checking cycles.
create function public.reject_parent_cycle() returns trigger language plpgsql set search_path='' as $$
declare parent_id uuid; cycle_found boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,2));
 if tg_table_name='tasks' then
  parent_id := new.parent_task_id;
  if parent_id is null then return new; end if;
  with recursive parents(id,parent) as (
   select id,parent_task_id from public.tasks where user_id=new.user_id and id=parent_id
   union select t.id,t.parent_task_id from public.tasks t join parents p on t.id=p.parent where t.user_id=new.user_id
  ) select exists(select 1 from parents where id=new.id) into cycle_found;
 else
  parent_id := new.parent_goal_id;
  if parent_id is null then return new; end if;
  with recursive parents(id,parent) as (
   select id,parent_goal_id from public.goals where user_id=new.user_id and id=parent_id
   union select t.id,t.parent_goal_id from public.goals t join parents p on t.id=p.parent where t.user_id=new.user_id
  ) select exists(select 1 from parents where id=new.id) into cycle_found;
 end if;
 if cycle_found then raise exception 'Circular parent link' using errcode='23514'; end if;
 return new;
end; $$;
create trigger task_parent_cycle before insert or update of parent_task_id on public.tasks for each row execute function public.reject_parent_cycle();
create trigger goal_parent_cycle before insert or update of parent_goal_id on public.goals for each row execute function public.reject_parent_cycle();

-- Atomic priority reorder with optimistic versions; no partial shortlist updates.
create function public.reorder_priorities(items jsonb) returns void language plpgsql set search_path='' as $$
declare item jsonb; seen integer;
begin
 if auth.uid() is null or not public.is_approved_user() then raise exception 'Not authorized' using errcode='42501'; end if;
 if jsonb_typeof(items)<>'array' or jsonb_array_length(items)>1000 then raise exception 'Invalid priority list' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,3));
 select count(distinct (x->>'id')) into seen from jsonb_array_elements(items) x;
 if seen<>jsonb_array_length(items) then raise exception 'Duplicate priority task' using errcode='23514'; end if;
 for item in select * from jsonb_array_elements(items) loop
  update public.tasks set priority_order=(item->>'position')::integer where id=(item->>'id')::uuid and user_id=auth.uid() and version=(item->>'version')::integer and deleted_at is null;
  if not found then raise exception 'Task changed; refresh before reordering' using errcode='40001'; end if;
 end loop;
end; $$;
revoke all on function public.reorder_priorities(jsonb) from public;
grant execute on function public.reorder_priorities(jsonb) to authenticated;

alter table public.task_occurrences add column version integer not null default 1;
alter table public.task_occurrences add column created_at timestamptz not null default now();
alter table public.task_occurrences add column updated_at timestamptz not null default now();
create trigger occurrence_stamp before update on public.task_occurrences for each row execute function public.stamp_record();
create trigger occurrence_audit after insert or update or delete on public.task_occurrences for each row execute function public.audit_record();

create function public.configure_recurrence(task_id_input uuid, expected_version integer, rule_input text, start_input date, end_input date, occurrence_dates date[], today_input date) returns void language plpgsql set search_path='' as $$
declare rule_id uuid; d date;
begin
 if auth.uid() is null or not public.is_approved_user() then raise exception 'Not authorized' using errcode='42501'; end if;
 if cardinality(occurrence_dates)>366 or length(rule_input)>500 or end_input<start_input then raise exception 'Invalid recurrence bounds' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,4));
 select recurrence_rule_id into rule_id from public.tasks where id=task_id_input and user_id=auth.uid() and version=expected_version and deleted_at is null for update;
 if not found then raise exception 'Task changed; refresh first' using errcode='40001'; end if;
 if rule_id is null then insert into public.recurrence_rules(user_id,rrule,start_date,end_date) values(auth.uid(),rule_input,start_input,end_input) returning id into rule_id;
 else update public.recurrence_rules set rrule=rule_input,start_date=start_input,end_date=end_input where id=rule_id and user_id=auth.uid(); end if;
 update public.tasks set recurrence_rule_id=rule_id,status='planned',completed_at=null,scheduling_mode='manual' where id=task_id_input and user_id=auth.uid();
 -- Retain all existing occurrences, including completed history. Cancel uncompleted future
 -- instances excluded by the changed rule; never delete or reopen completed ones.
 update public.task_occurrences set status='cancelled' where task_id=task_id_input and user_id=auth.uid() and scheduled_date>=today_input and status='planned' and not(scheduled_date=any(occurrence_dates));
 foreach d in array occurrence_dates loop
  if d<start_input or (end_input is not null and d>end_input) then raise exception 'Occurrence out of bounds' using errcode='23514'; end if;
  insert into public.task_occurrences(user_id,task_id,occurrence_key,scheduled_date) values(auth.uid(),task_id_input,d::text,d)
  on conflict(user_id,task_id,occurrence_key) do update set status='planned' where public.task_occurrences.status='cancelled';
 end loop;
end; $$;
revoke all on function public.configure_recurrence(uuid,integer,text,date,date,date[],date) from public;
grant execute on function public.configure_recurrence(uuid,integer,text,date,date,date[],date) to authenticated;
