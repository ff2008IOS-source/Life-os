create table public.personal_workflow_settings(user_id uuid not null references auth.users(id)on delete cascade,workflow_type text not null check(workflow_type in ('daily_check','career_debrief')),enabled boolean not null default false,run_time time not null default '20:00',weekday integer not null default 7 check(weekday between 1 and 7),timezone text not null default 'America/Vancouver' check(timezone='America/Vancouver'),primary key(user_id,workflow_type));
create table public.personal_workflow_runs(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id)on delete cascade,workflow_type text not null check(workflow_type in ('daily_check','career_debrief')),run_key text not null,scheduled_for timestamptz,generated_at timestamptz not null default now(),snapshot jsonb not null,unique(user_id,id),unique(user_id,run_key));
create index personal_workflow_history on public.personal_workflow_runs(user_id,generated_at desc);
alter table public.personal_workflow_settings enable row level security;
alter table public.personal_workflow_runs enable row level security;
revoke all on public.personal_workflow_settings,public.personal_workflow_runs from public,anon,authenticated;
grant select,insert,update on public.personal_workflow_settings to authenticated;
grant select on public.personal_workflow_runs to authenticated;
grant all on public.personal_workflow_settings,public.personal_workflow_runs to service_role;
create policy owner_settings on public.personal_workflow_settings for all to authenticated using(user_id=auth.uid()and public.is_approved_user())with check(user_id=auth.uid()and public.is_approved_user());
create policy owner_history on public.personal_workflow_runs for select to authenticated using(user_id=auth.uid()and public.is_approved_user());
create trigger audit after insert or update or delete on public.personal_workflow_runs for each row execute function public.audit_record();
create function public.prepare_personal_workflow(p_user uuid,p_type text,p_key text,p_scheduled timestamptz,p_now timestamptz)returns uuid language plpgsql security invoker set search_path='' as $$
declare result uuid;today date:=(coalesce(p_scheduled,p_now) at time zone 'America/Vancouver')::date;week_start date;week_end date;start_at timestamptz;end_at timestamptz;facts jsonb;count_rows integer;
begin
 if p_type not in ('daily_check','career_debrief')or not public.canvas_worker_owner(p_user)then raise exception 'Workflow owner or type unavailable'using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||':workflow:'||p_key,0));
 select id into result from public.personal_workflow_runs where user_id=p_user and run_key=p_key;if found then return result;end if;
 week_start:=today-((extract(isodow from today)::integer)-1);
 if p_type='daily_check'and extract(isodow from today)<>1 then week_start:=week_start+7;end if;
 week_end:=week_start+7;start_at:=week_start::timestamp at time zone 'America/Vancouver';end_at:=week_end::timestamp at time zone 'America/Vancouver';
 if p_type='daily_check' then
  select count(*)into count_rows from public.assessments where user_id=p_user;
  if count_rows>500 then raise exception 'Academic check exceeds the current safe collection limit';end if;
  select jsonb_build_object('week_start',week_start,'week_end_exclusive',week_end,'as_of',p_now,'assessments',coalesce((select jsonb_agg(to_jsonb(x))from(
   select a.id,a.title,c.code,a.due_date,a.due_at,a.verification_status,
    case when a.submission_state='excused' then 'excused'
     when ds.provider='canvas' and r.payload->'submission'->>'submitted_at' is not null then 'confirmed_submitted'
     when ds.provider='canvas' and(r.payload->'submission'->>'workflow_state'='unsubmitted'or r.payload->'submission'->>'missing'='true') then 'confirmed_incomplete'
     when ds.provider='canvas'then 'status_unknown'
     when a.verification_status in ('verified','user_confirmed')and a.submission_state in ('submitted','returned')then 'confirmed_submitted'
     when a.submission_state='not_submitted'then 'confirmed_incomplete'else 'status_unknown'end as completion_evidence,
    coalesce(a.due_at,a.due_date::timestamp at time zone 'America/Vancouver')<p_now as deadline_passed
   from public.assessments a join public.courses c on c.user_id=a.user_id and c.id=a.course_id
   left join public.data_sources ds on ds.user_id=a.user_id and ds.id=a.source_id
   left join public.canvas_mappings m on m.user_id=a.user_id and m.local_id=a.id and m.resource_type='assignment'
   left join public.canvas_records r on r.user_id=m.user_id and r.canvas_id=m.canvas_id and r.resource_type='assignment'
   where a.user_id=p_user and(a.due_date between week_start and week_end-1 or a.due_at>=start_at and a.due_at<end_at or coalesce(a.due_at,a.due_date::timestamp at time zone 'America/Vancouver')<p_now and a.submission_state not in ('submitted','excused'))
   order by coalesce(a.due_at,a.due_date::timestamp at time zone 'America/Vancouver'),a.id
  )x where not coalesce(x.deadline_passed,false)or x.completion_evidence not in ('confirmed_submitted','excused')),'[]'::jsonb),'unknown_deadlines',(select count(*)from public.assessments where user_id=p_user and due_at is null and due_date is null),'rule','A passed deadline or a recorded grade does not prove submission. Unverified sources require review.')into facts;
 else
  select jsonb_build_object('week_start',week_start,'week_end_exclusive',week_end,'as_of',p_now,
   'completed_tasks',coalesce((select jsonb_agg(to_jsonb(x))from(select id,title,completed_at,area_id,project_id from public.tasks where user_id=p_user and deleted_at is null and title not like '[TEST]%' and status='completed'and completed_at>=start_at and completed_at<end_at order by completed_at limit 501)x),'[]'::jsonb),
   'missed_tasks',coalesce((select jsonb_agg(to_jsonb(x))from(select id,title,due_at,due_date,area_id from public.tasks where user_id=p_user and deleted_at is null and title not like '[TEST]%' and status not in ('completed','cancelled')and coalesce(due_at,(due_date+1)::timestamp at time zone 'America/Vancouver')<p_now order by coalesce(due_at,due_date::timestamp at time zone 'America/Vancouver')limit 501)x),'[]'::jsonb),
   'milestones',coalesce((select jsonb_agg(to_jsonb(x))from(select id,title,goal_id,project_id,completed_at from public.milestones where user_id=p_user and title not like '[TEST]%' and completed_at>=start_at and completed_at<end_at order by completed_at limit 501)x),'[]'::jsonb),
   'active_projects',coalesce((select jsonb_agg(to_jsonb(x))from(select id,name,area_id,target_date from public.projects where user_id=p_user and name not like '[TEST]%' and status='active'order by name limit 501)x),'[]'::jsonb),
   'active_goals',coalesce((select jsonb_agg(to_jsonb(x))from(select id,title,progress_type,current_value,target_value from public.goals where user_id=p_user and title not like '[TEST]%' and status='active'order by title limit 501)x),'[]'::jsonb),
   'work',(select jsonb_build_object('sessions',count(*),'actual_minutes',coalesce(sum(actual_minutes),0),'academic_minutes',coalesce(sum(actual_minutes)filter(where course_id is not null),0))from public.work_completions w where w.user_id=p_user and w.reported_at>=start_at and w.reported_at<end_at and exists(select 1 from public.tasks t where t.id=w.task_id and t.user_id=w.user_id and t.title not like '[TEST]%')),
   'upcoming_tasks',coalesce((select jsonb_agg(to_jsonb(x))from(select id,title,due_at,due_date from public.tasks where user_id=p_user and deleted_at is null and title not like '[TEST]%' and status not in ('completed','cancelled')and coalesce(due_at,(due_date+1)::timestamp at time zone 'America/Vancouver')>=p_now and coalesce(due_at,(due_date+1)::timestamp at time zone 'America/Vancouver')<p_now+interval '7 days'order by coalesce(due_at,due_date::timestamp at time zone 'America/Vancouver')limit 501)x),'[]'::jsonb),
   'networking_followups',coalesce((select jsonb_agg(to_jsonb(x))from(select id,name,next_follow_up_date from public.contacts where user_id=p_user and next_follow_up_date<=today+7 order by next_follow_up_date limit 501)x),'[]'::jsonb),
   'academic_needs_review',(select count(*)from public.study_topics where user_id=p_user and mastery='needs_review'),
   'rule','Activities are not mastery or career outcomes. Only reported work effort is counted; synthetic [TEST] records are excluded. Unrecorded learning/networking progress is unknown. Proposed commitments require owner approval.')into facts;
  if exists(select 1 from jsonb_each(facts)where case when jsonb_typeof(value)='array'then jsonb_array_length(value)>500 else false end)then raise exception 'Career review exceeds the current safe collection limit';end if;
 end if;
 insert into public.personal_workflow_runs(user_id,workflow_type,run_key,scheduled_for,generated_at,snapshot)values(p_user,p_type,p_key,p_scheduled,p_now,facts)returning id into result;return result;
end$$;
revoke all on function public.prepare_personal_workflow(uuid,text,text,timestamptz,timestamptz)from public,anon,authenticated;
grant execute on function public.prepare_personal_workflow(uuid,text,text,timestamptz,timestamptz)to service_role;
create function public.prepare_my_workflow(p_type text,p_request uuid)returns uuid language plpgsql security definer set search_path='' as $$begin
 if not public.is_approved_user()or p_request is null then raise exception 'Unauthorized'using errcode='42501';end if;
 return public.prepare_personal_workflow(auth.uid(),p_type,'manual:'||p_request,null,now());end$$;
revoke all on function public.prepare_my_workflow(text,uuid)from public,anon;
grant execute on function public.prepare_my_workflow(text,uuid)to authenticated;
