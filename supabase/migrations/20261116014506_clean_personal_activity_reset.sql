alter table public.projects drop constraint projects_status_check;
alter table public.projects add constraint projects_status_check check(status in ('planned','active','paused','completed','cancelled'));
create table public.source_execution_settings(user_id uuid primary key references auth.users(id) on delete cascade,enabled boolean not null default false);
alter table public.source_execution_settings enable row level security;
revoke all on public.source_execution_settings from public,anon,authenticated;
grant select on public.source_execution_settings to authenticated;
grant all on public.source_execution_settings to service_role;
create policy own_read on public.source_execution_settings for select to authenticated using(user_id=(select auth.uid()) and public.is_approved_user());
create table public.source_execution_links(
 user_id uuid not null, dataset_id uuid not null,row_id uuid not null,kind text not null check(kind in ('project','task')),
 project_id uuid,task_id uuid,source_hash text not null,local_version integer not null,
 primary key(user_id,dataset_id,row_id,kind),
 foreign key(user_id,dataset_id,row_id) references public.sheet_rest_rows(user_id,dataset_id,id) on delete cascade,
 foreign key(user_id,project_id) references public.projects(user_id,id) on delete cascade,
 foreign key(user_id,task_id) references public.tasks(user_id,id) on delete cascade,
 check((kind='project' and project_id is not null and task_id is null) or(kind='task' and task_id is not null and project_id is null))
);
create index source_execution_project on public.source_execution_links(user_id,project_id) where project_id is not null;
create index source_execution_task on public.source_execution_links(user_id,task_id) where task_id is not null;
alter table public.source_execution_links enable row level security;
revoke all on public.source_execution_links from public,anon,authenticated;
grant select on public.source_execution_links to authenticated;
grant all on public.source_execution_links to service_role;
create policy own_read on public.source_execution_links for select to authenticated using(user_id=(select auth.uid()) and public.is_approved_user());
-- Local activity only. Provider records, grades, source ledgers and credentials are never deleted.
create table private.activity_reset_archives (
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null, created_at timestamptz not null default now(),
 records jsonb not null, primary key(user_id,request_id)
);
alter table private.activity_reset_archives enable row level security;
revoke all on private.activity_reset_archives from public,anon,authenticated;
grant all on private.activity_reset_archives to service_role;
create function private.activity_reset_snapshot(p_owner uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare snapshot jsonb:='{}'; name text; rows jsonb;
begin
 foreach name in array array['source_execution_settings','source_execution_links','notification_delivery_attempts','notifications','tasks','projects','reviews','review_items','review_chat_links','review_snapshots','assistant_conversations','assistant_exchanges','daily_check_ins','briefing_actions','focus_sessions','study_sessions','work_completions','work_blocks','scheduling_runs','scheduling_decisions','personal_workflow_runs','task_occurrences','recurrence_rules','task_dependencies','goal_tasks','goal_projects','sheet_rest_project_links','sheet_sync_mappings','managed_calendar_state','milestones','scheduling_automation','personal_workflow_settings'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb) from public.%I r where user_id=$1',name) into rows using p_owner;
  snapshot:=snapshot||jsonb_build_object(name,rows);
 end loop;
 -- Retain the old task links for recovery without copying grades or provider secrets.
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'task_id',task_id) order by id),'[]') into rows from public.assessments where user_id=p_owner and task_id is not null;
 return snapshot||jsonb_build_object('assessment_task_links',rows);
end $$;
revoke all on function private.activity_reset_snapshot(uuid) from public,anon,authenticated;
create function public.preview_personal_activity_reset() returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid(); snapshot jsonb; counts jsonb;
begin
 if owner is null or not public.is_approved_user() then raise exception 'Not authorized' using errcode='42501'; end if;
 snapshot:=private.activity_reset_snapshot(owner);
 select jsonb_object_agg(key,jsonb_array_length(value)) into counts from jsonb_each(snapshot);
 return jsonb_build_object('counts',counts,'token',md5(snapshot::text));
end $$;
revoke all on function public.preview_personal_activity_reset() from public,anon;
grant execute on function public.preview_personal_activity_reset() to authenticated;
create function public.reset_personal_activity(p_request uuid,p_expected text,p_confirmation text,p_rebuild boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid(); snapshot jsonb; counts jsonb; name text;
begin
 if owner is null or not public.is_approved_user() then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_request is null or p_expected is null or p_confirmation is distinct from 'CLEAR MY ACTIVITY' then raise exception 'Confirm the reviewed reset' using errcode='22023'; end if;
 perform 1 from public.profiles where user_id=owner for update;
 if exists(select 1 from private.activity_reset_archives where user_id=owner and request_id=p_request) then return jsonb_build_object('reset_id',p_request,'already_completed',true); end if;
 insert into public.calendar_write_locks(user_id,lease_token,lease_until) values(owner,gen_random_uuid(),now()-interval '1 second') on conflict(user_id) do nothing;
 perform 1 from public.calendar_write_locks where user_id=owner for update;
 if exists(select 1 from public.calendar_write_locks where user_id=owner and lease_until>=now()) or exists(select 1 from public.work_blocks where user_id=owner and calendar_event_id is not null and status in ('proposed','planned') and end_at>now()) then raise exception 'Resolve active calendar reservations before clearing local activity. No calendar events were changed.' using errcode='40001'; end if;
 snapshot:=private.activity_reset_snapshot(owner);
 if md5(snapshot::text)<>p_expected then raise exception 'Activity changed. Review the reset again.' using errcode='40001'; end if;
 if octet_length(snapshot::text)>20000000 then raise exception 'Export this workspace before a larger reset' using errcode='54000'; end if;
 insert into private.activity_reset_archives(user_id,request_id,records) values(owner,p_request,snapshot);
 insert into public.source_execution_settings(user_id,enabled) values(owner,p_rebuild) on conflict(user_id) do update set enabled=excluded.enabled;
 update public.scheduling_automation set enabled=false where user_id=owner;
 update public.personal_workflow_settings set enabled=false where user_id=owner;
 update public.assessments set task_id=null where user_id=owner and task_id is not null;
 -- Child-first deletes keep all ownership FKs and audit triggers enabled.
 foreach name in array array['notification_delivery_attempts','notifications','source_execution_links','review_items','review_snapshots','review_chat_links','reviews','assistant_conversations','daily_check_ins','briefing_actions','focus_sessions','study_sessions','scheduling_decisions','work_completions','managed_calendar_state','work_blocks','scheduling_runs','personal_workflow_runs','goal_tasks','goal_projects','sheet_rest_project_links','sheet_sync_mappings','task_dependencies','task_occurrences'] loop
  execute format('delete from public.%I where user_id=$1',name) using owner;
 end loop;
 delete from public.milestones where user_id=owner and project_id is not null;
 delete from public.tasks where user_id=owner;
 delete from public.recurrence_rules where user_id=owner;
 delete from public.projects where user_id=owner;
 select jsonb_object_agg(key,jsonb_array_length(value)) into counts from jsonb_each(snapshot);
 return jsonb_build_object('reset_id',p_request,'cleared',counts);
end $$;
revoke all on function public.reset_personal_activity(uuid,text,text,boolean) from public,anon;
grant execute on function public.reset_personal_activity(uuid,text,text,boolean) to authenticated;
-- A stale dated exam-preparation action is retained in the source plan, not resurfaced as new work.
create function private.stale_source_exam_action(value text) returns boolean language plpgsql stable set search_path='' as $$
declare matched text[]; month integer; day integer;
begin
 if value!~*'(prepare|review|protect).*(exam|midterm)' then return false;end if;
 matched:=regexp_match(value,'(Jan[a-z]*|Feb[a-z]*|Mar[a-z]*|Apr[a-z]*|May|Jun[a-z]*|Jul[a-z]*|Aug[a-z]*|Sep[a-z]*|Oct[a-z]*|Nov[a-z]*|Dec[a-z]*)[ ]+([0-9]{1,2})','i');
 if matched is null then return false;end if;
 month:=array_position(array['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'],lower(left(matched[1],3)));day:=matched[2]::integer;
 return make_date(extract(year from now() at time zone 'America/Vancouver')::integer,month,day)<(now() at time zone 'America/Vancouver')::date;
 exception when datetime_field_overflow then return true;
end $$;
revoke all on function private.stale_source_exam_action(text) from public,anon,authenticated;
-- Rebuild only from freshly synchronized, owned, unambiguous source rows. No provider writes.
create function public.rebuild_source_execution(p_dataset uuid) returns jsonb
language plpgsql security definer set search_path='' as $$

#variable_conflict use_variable
<<build_execution>>
declare owner uuid:=auth.uid(); d public.sheet_rest_datasets; r public.sheet_rest_rows; link public.source_execution_links;
 col jsonb; title_key text; status_key text; kind text; title text; status text; fingerprint text; local_id uuid; local_version integer; area uuid; source_area text; semester text;
 created integer:=0; changed integer:=0; conflicts integer:=0; skipped integer:=0;
begin
 if owner is null or not public.is_approved_user() then raise exception 'Not authorized' using errcode='42501'; end if;
 perform 1 from public.profiles where user_id=owner for update;
 if not exists(select 1 from public.source_execution_settings where user_id=owner and enabled) then return jsonb_build_object('enabled',false,'created',0); end if;
 select * into d from public.sheet_rest_datasets where user_id=owner and id=p_dataset for update;
 if not found or d.test_only or d.mode='paused' or d.last_read_at is null or d.last_read_at<now()-interval '10 minutes' or d.last_error is not null then raise exception 'Sync this source successfully before rebuilding its records' using errcode='40001'; end if;
 semester:=case when extract(month from now() at time zone 'America/Vancouver')<=4 then 'Spring ' when extract(month from now() at time zone 'America/Vancouver')<=8 then 'Summer ' else 'Fall ' end||extract(year from now() at time zone 'America/Vancouver')::text;
 select id into area from public.life_areas where user_id=owner and slug='career';
 foreach kind in array array['project','task'] loop
  title_key:=null;status_key:=null;
  for col in select value from jsonb_array_elements(d.config->'columns') loop
   if kind='project' and lower(col->>'header')='project' or kind='task' and lower(col->>'header') in ('task','next action','next step','action') then
    if title_key is not null then raise exception 'Ambiguous source title columns' using errcode='22023'; end if; title_key:=col->>'key';
   end if;
   if lower(col->>'header')='status' then status_key:=col->>'key';end if;
  end loop;
  if title_key is null then continue;end if;
  for r in select * from public.sheet_rest_rows where user_id=owner and dataset_id=d.id and state='synced' order by id loop
   title:=trim(r.local_values->>title_key); status:=lower(coalesce(r.local_values->>status_key,''));
   if title is null or length(title) not between 1 and 200 or title in ('-','—','N/A') then skipped:=skipped+1;continue;end if;
   if kind='task' and (status in ('complete','completed','done','cancelled','canceled') or (r.local_values->>'semester' is not null and r.local_values->>'semester'<>semester) or private.stale_source_exam_action(title)) then skipped:=skipped+1;continue;end if;
   fingerprint:=md5(r.local_values::text);
   select * into link from public.source_execution_links where user_id=owner and dataset_id=d.id and row_id=r.id and source_execution_links.kind=build_execution.kind;
   if found then
    if link.source_hash=fingerprint then continue; end if;
    if kind='project' then select version into local_version from public.projects where user_id=owner and id=link.project_id and deleted_at is null;
    else select version into local_version from public.tasks where user_id=owner and id=link.task_id and deleted_at is null;end if;
    if local_version is distinct from link.local_version then conflicts:=conflicts+1;continue;end if;
    if kind='project' then
     update public.projects set name=title,description='From '||d.title||'. Source status: '||coalesce(r.local_values->>status_key,'not recorded'),status=case when status in ('complete','completed','done') then 'completed' when status in ('active','in progress','ongoing') then 'active' when status in ('paused','on hold') then 'paused' else 'planned' end where user_id=owner and id=link.project_id returning id,version into local_id,local_version;
    else
     update public.tasks set title=title,description='From '||d.title||'. Source status: '||coalesce(r.local_values->>status_key,'not recorded') where user_id=owner and id=link.task_id returning id,version into local_id,local_version;
    end if;
    update public.source_execution_links set source_hash=fingerprint,local_version=build_execution.local_version where user_id=owner and dataset_id=d.id and row_id=r.id and source_execution_links.kind=build_execution.kind;
    changed:=changed+1;
   else
    if kind='project' then
     insert into public.projects(user_id,area_id,name,description,status,source_key) values(owner,area,title,'From '||d.title||'. Source status: '||coalesce(r.local_values->>status_key,'not recorded'),case when status in ('complete','completed','done') then 'completed' when status in ('active','in progress','ongoing') then 'active' when status in ('paused','on hold') then 'paused' else 'planned' end,'sheet-rest:'||d.id||':'||r.id) returning id,version into local_id,local_version;
    else
     insert into public.tasks(user_id,area_id,title,description,status,source_type,source_key,scheduling_mode) values(owner,area,title,'From '||d.title||'. Source status: '||coalesce(r.local_values->>status_key,'not recorded'),'inbox','sheets_action',d.id||':'||r.id,'manual') returning id,version into local_id,local_version;
    end if;
    insert into public.source_execution_links(user_id,dataset_id,row_id,kind,project_id,task_id,source_hash,local_version) values(owner,d.id,r.id,kind,case when kind='project' then local_id end,case when kind='task' then local_id end,fingerprint,local_version);
    created:=created+1;
   end if;
  end loop;
 end loop;
 return jsonb_build_object('enabled',true,'created',created,'updated',changed,'conflicts',conflicts,'skipped',skipped);
end $$;
revoke all on function public.rebuild_source_execution(uuid) from public,anon;
grant execute on function public.rebuild_source_execution(uuid) to authenticated;
