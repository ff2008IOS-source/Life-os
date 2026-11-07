-- Reproduce previously dashboard-created tables, then add the durable read-only integration.
create table if not exists public.canvas_connections(user_id uuid primary key references auth.users(id) on delete cascade,token_ciphertext text not null,token_iv text not null,expires_at timestamptz,last_sync_at timestamptz,last_error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists public.canvas_records(user_id uuid not null references auth.users(id) on delete cascade,resource_type text not null,canvas_id text not null,course_canvas_id text,payload jsonb not null,synced_at timestamptz not null default now(),primary key(user_id,resource_type,canvas_id));
alter table public.canvas_connections add column if not exists generation uuid not null default gen_random_uuid(),add column if not exists enabled boolean not null default true,add column if not exists lease_token uuid,add column if not exists lease_until timestamptz,add column if not exists last_attempt_at timestamptz;
create table public.canvas_sync_jobs(user_id uuid not null references auth.users(id) on delete cascade,job_key text not null,resource_type text not null,path text not null,params jsonb not null default '{}',course_canvas_id text,single_resource boolean not null default false,priority integer not null default 5,interval_minutes integer not null default 60 check(interval_minutes>=30),next_url text,seen_urls jsonb not null default '[]',page_count integer not null default 0,next_run_at timestamptz not null default now(),last_success_at timestamptz,last_error text,attempts integer not null default 0,primary key(user_id,job_key));
create table public.canvas_mappings(user_id uuid not null references auth.users(id) on delete cascade,resource_type text not null,canvas_id text not null,local_id uuid,local_table text,base_state jsonb not null default '{}',conflict text,last_checked_at timestamptz not null default now(),primary key(user_id,resource_type,canvas_id),foreign key(user_id,resource_type,canvas_id) references public.canvas_records(user_id,resource_type,canvas_id) on delete cascade);
create table public.canvas_grade_history(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,canvas_id text not null,previous_state jsonb,current_state jsonb not null,recorded_at timestamptz not null default now());
create index canvas_records_course on public.canvas_records(user_id,course_canvas_id,resource_type);
create index canvas_jobs_due on public.canvas_sync_jobs(next_run_at,user_id);
create index canvas_grade_history_owner on public.canvas_grade_history(user_id,recorded_at);
-- Never expose credential ciphertext, even to an otherwise approved browser session.
alter table public.canvas_connections enable row level security;
alter table public.canvas_records enable row level security;
alter table public.canvas_sync_jobs enable row level security;
alter table public.canvas_mappings enable row level security;
alter table public.canvas_grade_history enable row level security;
drop policy if exists canvas_connections_owner on public.canvas_connections;
drop policy if exists canvas_records_owner on public.canvas_records;
revoke all on public.canvas_connections,public.canvas_records,public.canvas_sync_jobs,public.canvas_mappings,public.canvas_grade_history from public,anon,authenticated;
grant all on public.canvas_connections,public.canvas_records,public.canvas_sync_jobs,public.canvas_mappings,public.canvas_grade_history to service_role;
grant select on public.canvas_records,public.canvas_sync_jobs,public.canvas_mappings,public.canvas_grade_history to authenticated;
create policy owner_read on public.canvas_records for select to authenticated using(user_id=auth.uid() and public.is_approved_user());
create policy owner_read on public.canvas_sync_jobs for select to authenticated using(user_id=auth.uid() and public.is_approved_user());
create policy owner_read on public.canvas_mappings for select to authenticated using(user_id=auth.uid() and public.is_approved_user());
create policy owner_read on public.canvas_grade_history for select to authenticated using(user_id=auth.uid() and public.is_approved_user());
create function public.canvas_claim(p_user uuid,p_token uuid) returns boolean language plpgsql security invoker set search_path='' as $$begin
 update public.canvas_connections set lease_token=p_token,lease_until=now()+interval '2 minutes',last_attempt_at=now() where user_id=p_user and enabled and expires_at>now() and(lease_until is null or lease_until<now());return found;end$$;
revoke all on function public.canvas_claim(uuid,uuid) from public,anon,authenticated;
grant execute on function public.canvas_claim(uuid,uuid) to service_role;
-- Match term identity by year + season, never course code alone across terms.
create function public.canvas_term_key(value text) returns text language sql immutable set search_path='' as $$select coalesce(substring(value from '(20[0-9]{2})'),'')||':'||coalesce(substring(lower(value) from '(fall|spring|summer|winter)'),lower(value))$$;
create function public.canvas_reconcile(p_user uuid,p_type text,p_id text,p_course text,p_values jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare m public.canvas_mappings;c uuid;tm uuid;src uuid;target uuid;candidate_count integer;current_state jsonb;v jsonb:=p_values;old_state jsonb;expected jsonb;g uuid;task uuid;
begin
 select * into m from public.canvas_mappings where user_id=p_user and resource_type=p_type and canvas_id=p_id for update;
 if not found then insert into public.canvas_mappings(user_id,resource_type,canvas_id)values(p_user,p_type,p_id);end if;
 if p_type='course' then
  if v->>'code' is null or v->>'term' is null then update public.canvas_mappings set conflict='Course code or academic term is unavailable; manual mapping required.' where user_id=p_user and resource_type=p_type and canvas_id=p_id;return;end if;
  if m.local_id is null then
   select count(*) into candidate_count from public.courses x join public.academic_terms t on t.id=x.term_id and t.user_id=x.user_id where x.user_id=p_user and regexp_replace(upper(x.code),'[^A-Z0-9]','','g')=regexp_replace(upper(v->>'code'),'[^A-Z0-9]','','g') and public.canvas_term_key(t.name)=public.canvas_term_key(v->>'term');
   if candidate_count>1 then update public.canvas_mappings set conflict='More than one existing course matches; manual mapping required.' where user_id=p_user and resource_type=p_type and canvas_id=p_id;return;end if;
   select x.id into c from public.courses x join public.academic_terms t on t.id=x.term_id and t.user_id=x.user_id where x.user_id=p_user and regexp_replace(upper(x.code),'[^A-Z0-9]','','g')=regexp_replace(upper(v->>'code'),'[^A-Z0-9]','','g') and public.canvas_term_key(t.name)=public.canvas_term_key(v->>'term');
   if c is null then
    select id into tm from public.academic_terms where user_id=p_user and public.canvas_term_key(name)=public.canvas_term_key(v->>'term') order by created_at limit 1;
    if tm is null then insert into public.academic_terms(user_id,name)values(p_user,v->>'term')returning id into tm;end if;
    insert into public.data_sources(user_id,provider,source_key,reference_url,verification_status,last_checked_at) values(p_user,'canvas','course:'||p_id,'https://canvas.sfu.ca/courses/'||p_id,'verified',now()) on conflict(user_id,provider,source_key)do update set last_checked_at=now() returning id into src;
    insert into public.courses(user_id,term_id,code,title,source_id,verification_status)values(p_user,tm,v->>'code',v->>'title',src,'verified')returning id into c;
   end if;
   update public.canvas_mappings set local_id=c,local_table='courses',conflict=null,last_checked_at=now() where user_id=p_user and resource_type=p_type and canvas_id=p_id;
  end if;return;
 end if;
 select local_id into c from public.canvas_mappings where user_id=p_user and resource_type='course' and canvas_id=p_course;
 if c is null then update public.canvas_mappings set conflict='Waiting for a confirmed course mapping.' where user_id=p_user and resource_type=p_type and canvas_id=p_id;return;end if;
 if p_type='assignment_group' then
  if m.local_id is null then
   select id into g from public.grading_categories where user_id=p_user and course_id=c and name=v->>'name';
   if g is not null then update public.canvas_mappings set local_id=g,local_table='grading_categories',conflict='Existing grading category preserved. Review Canvas weights before adopting them.',last_checked_at=now()where user_id=p_user and resource_type=p_type and canvas_id=p_id;return;end if;
   insert into public.grading_categories(user_id,course_id,name,weight)values(p_user,c,v->>'name',(v->>'weight')::numeric)returning id into g;
  else
   g:=m.local_id;
   select jsonb_build_object('name',name,'weight',weight)into current_state from public.grading_categories where user_id=p_user and id=g for update;
   if m.base_state='{}' or current_state is distinct from m.base_state then update public.canvas_mappings set conflict='Local grading category changed. Review Canvas values.',last_checked_at=now()where user_id=p_user and resource_type=p_type and canvas_id=p_id;return;end if;
   if current_state is distinct from v then update public.grading_categories set name=v->>'name',weight=(v->>'weight')::numeric where user_id=p_user and id=g;end if;
  end if;
  update public.canvas_mappings set local_id=g,local_table='grading_categories',base_state=v,conflict=null,last_checked_at=now()where user_id=p_user and resource_type=p_type and canvas_id=p_id;return;
 end if;
 if p_type<>'assignment' then return;end if;
 select local_id into g from public.canvas_mappings where user_id=p_user and resource_type='assignment_group' and canvas_id=p_course||':'||(v->>'group_id') and conflict is null;
 if m.local_id is null then
  select count(*) into candidate_count from public.assessments where user_id=p_user and course_id=c and lower(trim(title))=lower(trim(v->>'title'));
  if candidate_count>1 then update public.canvas_mappings set conflict='Multiple assessments share this name; manual mapping required.' where user_id=p_user and resource_type=p_type and canvas_id=p_id;return;end if;
  select id into target from public.assessments where user_id=p_user and course_id=c and lower(trim(title))=lower(trim(v->>'title'));
  if target is not null then
   -- Preserve pre-existing manual/spreadsheet grades until explicitly reconciled.
   update public.canvas_mappings set local_id=target,local_table='assessments',conflict='Existing assessment preserved. Review Canvas values before adopting them.',last_checked_at=now() where user_id=p_user and resource_type=p_type and canvas_id=p_id;return;
  end if;
  insert into public.data_sources(user_id,provider,source_key,reference_url,verification_status,last_checked_at)values(p_user,'canvas','assignment:'||p_id,v->>'url','verified',now())on conflict(user_id,provider,source_key)do update set last_checked_at=now()returning id into src;
  insert into public.assessments(user_id,course_id,category_id,title,maximum_score,earned_score,submission_state,due_at,verification_status,source_id,source_key)values(p_user,c,g,v->>'title',(v->>'maximum_score')::numeric,(v->>'earned_score')::numeric,v->>'submission_state',(v->>'due_at')::timestamptz,'verified',src,'canvas:'||p_id)returning id into target;
 else
  target:=m.local_id;
  select jsonb_build_object('title',title,'maximum_score',maximum_score,'earned_score',earned_score,'submission_state',submission_state,'due_at',to_jsonb(due_at)) into current_state from public.assessments where user_id=p_user and id=target for update;
  old_state:=m.base_state;
  if old_state='{}' or current_state is distinct from old_state then update public.canvas_mappings set conflict='Local academic fields changed. Canvas snapshot retained for review.',last_checked_at=now() where user_id=p_user and resource_type=p_type and canvas_id=p_id;return;end if;
  if ((v->'earned_score'='null' and old_state->'earned_score'<>'null') or (v->'due_at'='null' and old_state->'due_at'<>'null')) then update public.canvas_mappings set conflict='Canvas omitted previously known information. Review before clearing local values.' where user_id=p_user and resource_type=p_type and canvas_id=p_id;return;end if;
  expected:=jsonb_build_object('title',v->>'title','maximum_score',(v->>'maximum_score')::numeric,'earned_score',(v->>'earned_score')::numeric,'submission_state',v->>'submission_state','due_at',to_jsonb((v->>'due_at')::timestamptz));
  if current_state is distinct from expected then
  update public.assessments set title=v->>'title',maximum_score=(v->>'maximum_score')::numeric,earned_score=(v->>'earned_score')::numeric,submission_state=v->>'submission_state',due_at=(v->>'due_at')::timestamptz,due_date=null where user_id=p_user and id=target;
  end if;
 end if;
 if g is not null then update public.assessments set category_id=g where user_id=p_user and id=target and category_id is null;end if;
 select jsonb_build_object('title',title,'maximum_score',maximum_score,'earned_score',earned_score,'submission_state',submission_state,'due_at',to_jsonb(due_at)) into current_state from public.assessments where user_id=p_user and id=target;
 update public.canvas_mappings set local_id=target,local_table='assessments',base_state=current_state,conflict=null,last_checked_at=now() where user_id=p_user and resource_type=p_type and canvas_id=p_id;
 -- Linked tasks adopt only unchanged deadlines; estimates and completion remain Life OS-owned.
 select task_id into task from public.assessments where user_id=p_user and id=target;
 if task is not null then update public.tasks set due_at=(v->>'due_at')::timestamptz,due_date=null where user_id=p_user and id=task and due_at is distinct from (v->>'due_at')::timestamptz and due_date is null and (due_at is not distinct from (old_state->>'due_at')::timestamptz);end if;
end$$;
revoke all on function public.canvas_reconcile(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.canvas_reconcile(uuid,text,text,text,jsonb) to service_role;
-- Provider page, grade history, local reconciliation and cursor commit together.
create function public.canvas_store_page(p_user uuid,p_lease uuid,p_generation uuid,p_job text,p_records jsonb,p_next text,p_current text,p_children jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare r jsonb;old jsonb;current_grade jsonb;old_grade jsonb;changed boolean;begin
 perform 1 from public.canvas_connections where user_id=p_user and lease_token=p_lease and generation=p_generation and lease_until>now() for update;
 if not found then raise exception 'Canvas lease or token changed' using errcode='40001';end if;
 if jsonb_array_length(p_records)>100 or jsonb_array_length(p_children)>300 then raise exception 'Canvas page too large';end if;
 for r in select * from jsonb_array_elements(p_records) loop
  select payload into old from public.canvas_records where user_id=p_user and resource_type=r->>'type' and canvas_id=r->>'id';
  if r->>'type' in ('assignment','submission') then
   current_grade:=case when r->>'type'='assignment' then r->'payload'->'submission' else r->'payload' end;
   old_grade:=case when r->>'type'='assignment' then old->'submission' else old end;
   current_grade:=jsonb_build_object('score',current_grade->'score','grade',current_grade->'grade','state',current_grade->'workflow_state','excused',current_grade->'excused');
   old_grade:=jsonb_build_object('score',old_grade->'score','grade',old_grade->'grade','state',old_grade->'workflow_state','excused',old_grade->'excused');
   if current_grade is distinct from old_grade then insert into public.canvas_grade_history(user_id,canvas_id,previous_state,current_state)values(p_user,(r->>'type')||':'||(r->>'id'),case when old is null then null else old_grade end,current_grade);end if;
  end if;
  changed:=old is distinct from r->'payload';
  insert into public.canvas_records(user_id,resource_type,canvas_id,course_canvas_id,payload)values(p_user,r->>'type',r->>'id',r->>'course',r->'payload')on conflict(user_id,resource_type,canvas_id)do update set payload=excluded.payload,synced_at=now();
  if r->'normalized' is not null and r->'normalized'<>'null' then perform public.canvas_reconcile(p_user,r->>'type',r->>'id',r->>'course',r->'normalized');end if;
 end loop;
 for r in select * from jsonb_array_elements(p_children) loop
  insert into public.canvas_sync_jobs(user_id,job_key,resource_type,path,params,course_canvas_id,single_resource,interval_minutes,priority)values(p_user,r->>'key',r->>'type',r->>'path',coalesce(r->'params','{}'),r->>'course',coalesce((r->>'single')::boolean,false),(r->>'minutes')::integer,case when r->>'type' in ('assignment','submission','announcement','enrollment','calendar_event')then 1 else 5 end)on conflict(user_id,job_key)do nothing;
 end loop;
 update public.canvas_sync_jobs set next_url=p_next,seen_urls=case when p_next is null then '[]'::jsonb else seen_urls||to_jsonb(p_current) end,page_count=case when p_next is null then 0 else page_count+1 end,last_success_at=case when p_next is null then now() else last_success_at end,last_error=null,attempts=0,next_run_at=case when p_next is null then now()+make_interval(mins=>interval_minutes) else now() end where user_id=p_user and job_key=p_job;
 update public.canvas_connections set last_sync_at=case when p_next is null then now() else last_sync_at end,last_error=null where user_id=p_user;
end$$;
revoke all on function public.canvas_store_page(uuid,uuid,uuid,text,jsonb,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.canvas_store_page(uuid,uuid,uuid,text,jsonb,text,text,jsonb) to service_role;
create table public.canvas_token_attempts(user_id uuid primary key references auth.users(id) on delete cascade,last_attempt timestamptz not null default now());
alter table public.canvas_token_attempts enable row level security;
revoke all on public.canvas_token_attempts from public,anon,authenticated;
grant all on public.canvas_token_attempts to service_role;
create function public.canvas_token_attempt(p_user uuid) returns boolean language plpgsql security invoker set search_path='' as $$begin
 insert into public.canvas_token_attempts(user_id)values(p_user)on conflict(user_id)do update set last_attempt=now()where public.canvas_token_attempts.last_attempt<now()-interval '15 seconds';return found;end$$;
revoke all on function public.canvas_token_attempt(uuid) from public,anon,authenticated;
grant execute on function public.canvas_token_attempt(uuid) to service_role;
create function public.canvas_worker_owner(p_user uuid)returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from private.approved_users where user_id=p_user)$$;
revoke all on function public.canvas_worker_owner(uuid) from public,anon,authenticated;
grant execute on function public.canvas_worker_owner(uuid) to service_role;
create function public.canvas_accept(p_user uuid,p_type text,p_id text,p_target uuid,p_values jsonb,p_source jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare c uuid;existing uuid;state jsonb;src uuid;begin
 perform 1 from public.canvas_records where user_id=p_user and resource_type=p_type and canvas_id=p_id and payload=p_source for update;
 if not found then raise exception 'Canvas source changed; review again' using errcode='40001';end if;
 if p_type='course' then
  if not exists(select 1 from public.courses where user_id=p_user and id=p_target)then raise exception 'Unknown owned course';end if;
  update public.canvas_mappings set local_id=p_target,local_table='courses',conflict=null,last_checked_at=now() where user_id=p_user and resource_type='course' and canvas_id=p_id and local_id is null;
  if not found then raise exception 'Course already mapped or missing';end if;return;
 end if;
 if p_type='assignment_group' then
  select local_id into existing from public.canvas_mappings where user_id=p_user and resource_type=p_type and canvas_id=p_id for update;
  if existing is null or existing<>p_target then raise exception 'Category mapping changed';end if;
  update public.grading_categories set name=p_values->>'name',weight=(p_values->>'weight')::numeric where user_id=p_user and id=p_target;
  update public.canvas_mappings set base_state=p_values,conflict=null,last_checked_at=now()where user_id=p_user and resource_type=p_type and canvas_id=p_id;return;
 end if;
 if p_type<>'assignment' then raise exception 'Unsupported resolution';end if;
 select local_id into existing from public.canvas_mappings where user_id=p_user and resource_type=p_type and canvas_id=p_id for update;
 if existing is null or existing<>p_target then raise exception 'Assessment mapping changed';end if;
 -- Explicit owner approval: replace mapped Canvas fields only, retaining notes, task links and study data.
 insert into public.data_sources(user_id,provider,source_key,reference_url,verification_status,last_checked_at)values(p_user,'canvas','assignment:'||p_id,p_values->>'url','verified',now())on conflict(user_id,provider,source_key)do update set last_checked_at=now()returning id into src;
 update public.assessments set source_id=src,source_key='canvas:'||p_id,title=p_values->>'title',earned_score=(p_values->>'earned_score')::numeric,maximum_score=(p_values->>'maximum_score')::numeric,submission_state=p_values->>'submission_state',due_at=(p_values->>'due_at')::timestamptz,due_date=null,score_unit='points',verification_status='verified' where user_id=p_user and id=p_target returning jsonb_build_object('title',title,'maximum_score',maximum_score,'earned_score',earned_score,'submission_state',submission_state,'due_at',to_jsonb(due_at))into state;
 if not found then raise exception 'Unknown owned assessment';end if;
 update public.canvas_mappings set base_state=state,conflict=null,last_checked_at=now()where user_id=p_user and resource_type=p_type and canvas_id=p_id;
end$$;
revoke all on function public.canvas_accept(uuid,text,text,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.canvas_accept(uuid,text,text,uuid,jsonb,jsonb) to service_role;
create function public.canvas_create_task(p_user uuid,p_id text)returns uuid language plpgsql security invoker set search_path='' as $$declare a public.assessments;tid uuid;area uuid;begin
 select x.* into a from public.assessments x join public.canvas_mappings m on m.user_id=x.user_id and m.local_id=x.id and m.resource_type='assignment' where x.user_id=p_user and m.canvas_id=p_id and m.conflict is null for update of x;
 if not found then raise exception 'Reconcile the assessment before adding it to Planner';end if;
 if a.task_id is not null then return a.task_id;end if;
 select id into area from public.life_areas where user_id=p_user and slug='academics';
 insert into public.tasks(user_id,title,description,area_id,due_at,due_date,scheduling_mode)values(p_user,left(a.title,200),'Canvas-linked academic responsibility. Add an effort estimate before opting into scheduling.',area,a.due_at,a.due_date,'manual')returning id into tid;
 update public.assessments set task_id=tid where user_id=p_user and id=a.id;return tid;end$$;
revoke all on function public.canvas_create_task(uuid,text) from public,anon,authenticated;
grant execute on function public.canvas_create_task(uuid,text) to service_role;
create view public.canvas_deadlines with(security_invoker=true) as
select r.user_id,r.canvas_id,r.course_canvas_id,r.payload->>'name' as title,(r.payload->>'due_at')::timestamptz as due_at,r.synced_at,m.conflict,x.task_id,c.code as course_code
from public.canvas_records r left join public.canvas_mappings m on m.user_id=r.user_id and m.resource_type=r.resource_type and m.canvas_id=r.canvas_id left join public.assessments x on x.user_id=m.user_id and x.id=m.local_id left join public.courses c on c.user_id=x.user_id and c.id=x.course_id
where r.resource_type='assignment' and r.payload->>'due_at' is not null;
revoke all on public.canvas_deadlines from public,anon;
grant select on public.canvas_deadlines to authenticated,service_role;
create function public.canvas_request_refresh(p_user uuid)returns void language sql security invoker set search_path='' as $$update public.canvas_sync_jobs set next_run_at=now()where user_id=p_user and last_error is null and next_url is null and last_success_at<now()-interval '30 seconds'$$;
revoke all on function public.canvas_request_refresh(uuid) from public,anon,authenticated;
grant execute on function public.canvas_request_refresh(uuid) to service_role;
