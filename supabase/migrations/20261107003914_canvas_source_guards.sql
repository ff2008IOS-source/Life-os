-- Incomplete provider data must not silently erase previously confirmed values.
create or replace function public.canvas_reconcile(p_user uuid,p_type text,p_id text,p_course text,p_values jsonb) returns void language plpgsql security invoker set search_path='' as $$
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
   if v->'weight'='null' and current_state->'weight'<>'null' then update public.canvas_mappings set conflict='Canvas omitted a known group weight. Review before clearing it.'where user_id=p_user and resource_type=p_type and canvas_id=p_id;return;end if;
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
  if ((v->'maximum_score'='null' and old_state->'maximum_score'<>'null') or (v->'submission_state'='"unknown"' and old_state->'submission_state'<>'"unknown"') or (v->'earned_score'='null' and old_state->'earned_score'<>'null') or (v->'due_at'='null' and old_state->'due_at'<>'null')) then update public.canvas_mappings set conflict='Canvas omitted previously known information. Review before clearing local values.' where user_id=p_user and resource_type=p_type and canvas_id=p_id;return;end if;
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
