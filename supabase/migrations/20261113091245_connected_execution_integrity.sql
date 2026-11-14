-- Additive migration. No source-provider writes and no deletion of existing records.
alter table public.courses add column inventory_confirmed boolean not null default false;
alter table public.courses add column grading_rules_confirmed boolean not null default false;
alter table public.tasks add column is_example boolean not null default false;
update public.tasks set is_example=true where source_type='test' or title like '[TEST]%';
alter table public.projects add column is_example boolean not null default false;
alter table public.goals add column is_example boolean not null default false;
-- Identify existing known beta examples once; later decisions use explicit metadata.
update public.projects set is_example=true where name like '[TEST]%';
update public.goals set is_example=true where title like '[TEST]%';
-- Explicitly requested synthetic beta examples. No real user context is seeded.
create or replace function public.add_beta_examples() returns void language plpgsql set search_path = '' as $$
declare area uuid; project uuid; goal uuid;
begin
 if auth.uid() is null or not public.is_approved_user() then raise exception 'Not authorized' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,1));
 perform public.initialize_workspace();
 select id into area from public.life_areas where user_id=auth.uid() and slug='projects';
 select id into project from public.projects where user_id=auth.uid() and name='[TEST] A sample project' limit 1;
 if project is null then insert into public.projects(user_id,area_id,name,description,is_example) values(auth.uid(),area,'[TEST] A sample project','Synthetic beta example. Not a real commitment.',true) returning id into project; end if;
 select id into goal from public.goals where user_id=auth.uid() and title='[TEST] Explore a complete workflow' limit 1;
 if goal is null then insert into public.goals(user_id,area_id,title,description,progress_type,is_example) values(auth.uid(),area,'[TEST] Explore a complete workflow','Synthetic beta example. Edit, link tasks, and add a milestone.','milestone',true) returning id into goal;
 insert into public.milestones(user_id,goal_id,project_id,title) values(auth.uid(),goal,project,'[TEST] Finish the beta walkthrough'); end if;
 insert into public.tasks(user_id,area_id,project_id,title,description,status,estimated_minutes,scheduling_mode,source_type,source_key)
 values(auth.uid(),area,project,'[TEST] Try completing a task','Synthetic beta task. No real deadline.','inbox',30,'manual','test','beta-task-1'),
 (auth.uid(),area,project,'[TEST] Preview a focused work session','Synthetic beta task. No real availability or calendar writes.','planned',60,'eligible','test','beta-task-2') on conflict(user_id,source_type,source_key) do nothing;
 insert into public.goal_tasks(user_id,goal_id,task_id) select auth.uid(),goal,id from public.tasks where user_id=auth.uid() and source_type='test' and source_key in ('beta-task-1','beta-task-2') on conflict do nothing;
end; $$;
revoke all on function public.add_beta_examples() from public;
grant execute on function public.add_beta_examples() to authenticated;

-- Owner-invoked preparation links one existing assessment to one canonical task.
create function public.prepare_assessment(p_assessment uuid,p_version integer,p_minutes integer,p_eligible boolean) returns uuid language plpgsql security invoker set search_path='' as $$
declare a public.assessments; tid uuid; area uuid; owner uuid:=(select auth.uid());
begin
 if owner is null or not public.is_approved_user() then raise exception 'Not authorized' using errcode='42501';end if;
 if p_minutes is null or p_minutes not between 1 and 100000 or p_eligible is null then raise exception 'Explicit effort estimate required' using errcode='22023';end if;
 select * into a from public.assessments where user_id=owner and id=p_assessment for update;
 if not found then raise exception 'Owned assessment unavailable' using errcode='P0002';end if;
 -- A lost response must never make a duplicate or overwrite the already prepared task.
 if a.task_id is not null then return a.task_id;end if;
 if a.version<>p_version then raise exception 'Assessment changed' using errcode='40001';end if;
 if a.dropped or a.submission_state in('submitted','returned','excused')then raise exception 'This assessment does not require an unfinished preparation task'using errcode='22023';end if;
 select id into area from public.life_areas where user_id=owner and slug='academics';
 if area is null then raise exception 'Initialize the academic area first' using errcode='22023';end if;
 insert into public.tasks(user_id,title,description,area_id,course_id,due_at,due_date,estimated_minutes,scheduling_mode,source_type,source_key)
 values(owner,left('Prepare: '||a.title,200),'Preparation task linked to an assessment. Completing preparation does not submit the assessment or establish mastery.',area,a.course_id,a.due_at,a.due_date,p_minutes,case when p_eligible then 'eligible' else 'manual' end,'assessment_preparation',a.id::text) returning id into tid;
 update public.assessments set task_id=tid where user_id=owner and id=a.id;
 return tid;
end$$;
revoke all on function public.prepare_assessment(uuid,integer,integer,boolean)from public,anon;
grant execute on function public.prepare_assessment(uuid,integer,integer,boolean)to authenticated;
-- Reuse review_items for approved task commitments; task status remains canonical.
create unique index review_approved_task_once on public.review_items(user_id,review_id,task_id)where item_type='approved_commitment';
create table public.review_snapshots(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id)on delete cascade,
 review_id uuid not null,captured_at timestamptz not null default now(),facts jsonb not null check(jsonb_typeof(facts)='object'),
 unique(user_id,review_id),foreign key(user_id,review_id)references public.reviews(user_id,id)
);
alter table public.review_snapshots enable row level security;
revoke all on public.review_snapshots from public,anon,authenticated;
grant select on public.review_snapshots to authenticated;
grant insert(user_id,review_id,facts) on public.review_snapshots to authenticated;
grant all on public.review_snapshots to service_role;
create policy owner_read on public.review_snapshots for select to authenticated using(user_id=(select auth.uid())and public.is_approved_user());
create policy owner_capture on public.review_snapshots for insert to authenticated with check(user_id=(select auth.uid())and public.is_approved_user()and octet_length(facts::text)<=262144);
create trigger audit after insert or update or delete on public.review_snapshots for each row execute function public.audit_record();
create index review_snapshot_review on public.review_snapshots(user_id,review_id);
create index review_items_commitment_lookup on public.review_items(user_id,item_type,review_id,task_id);
