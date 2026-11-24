alter table public.study_topics add column mastery_manual boolean not null default false,
  add column section text, add column source_file text, add column source_folder text;
-- Earlier manually entered topics have no reliable per-field history.
update public.study_topics set mastery_manual=true where source_key is null or version>1;
alter table public.canvas_documents add column topic_version text,
  add column topic_cursor integer not null default 0,
  add column topics_complete boolean not null default false,
  add column topic_attempt_at timestamptz;

create table public.topic_suggestions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  course_id uuid not null, title text not null, title_key text not null,
  source_key text not null, source_file text not null, section text not null, source_folder text,
  state text not null default 'suggested' check(state in ('suggested','dismissed','added')),
  unique(user_id,course_id,source_key,title_key),
  foreign key(user_id,course_id) references public.courses(user_id,id) on delete cascade
);
alter table public.topic_suggestions enable row level security;
revoke all on public.topic_suggestions from public,anon,authenticated;
grant select on public.topic_suggestions to authenticated;
grant all on public.topic_suggestions to service_role;
create policy owner_read on public.topic_suggestions for select to authenticated
using(user_id=auth.uid() and public.is_approved_user());
create function public.topic_key(t text) returns text language sql immutable set search_path='' as $$
  select trim(regexp_replace(lower(t),'[^[:alnum:]]+',' ','g'))
$$;

create function public.next_topic_excerpt(p_user uuid,p_course uuid) returns jsonb
language sql stable set search_path='' as $$
select to_jsonb(work) from (
 select d.course_canvas_id,d.canvas_file_id,d.title,d.source_version,m.local_id as course_id,c.chunk_index,c.text,
   (select parent.payload->>'name' from public.canvas_records item join public.canvas_records parent
    on parent.user_id=item.user_id and parent.course_canvas_id=item.course_canvas_id and parent.resource_type='module'
    and parent.payload->>'id'=item.payload->>'module_id'
    where item.resource_type='module_item' and item.user_id=d.user_id and item.course_canvas_id=d.course_canvas_id
    and lower(item.payload->>'type')='file' and item.payload->>'content_id'=d.canvas_file_id order by item.canvas_id limit 1) as folder
 from public.canvas_documents d join public.canvas_mappings m on m.user_id=d.user_id
 and m.resource_type='course' and m.canvas_id=d.course_canvas_id and m.local_table='courses' and m.conflict is null
 join public.canvas_document_chunks c on (c.user_id,c.course_canvas_id,c.canvas_file_id)=(d.user_id,d.course_canvas_id,d.canvas_file_id)
 where d.user_id=p_user and m.local_id is not null and (p_course is null or m.local_id=p_course)
 and d.state='ready' and (not d.topics_complete or d.topic_version is distinct from d.source_version)
 and c.chunk_index=case when d.topic_version=d.source_version then d.topic_cursor else 0 end
 order by d.topic_attempt_at nulls first,d.canvas_file_id limit 1
) work
$$;
create function public.reserve_topic_excerpt(p_user uuid,p_request uuid,p_budget int,p_course text,p_file text,p_version text,p_cursor int)
returns text language plpgsql set search_path='' as $$
declare s public.assistant_settings; day date:=(now() at time zone 'America/Vancouver')::date;
begin
 select * into s from public.assistant_settings where user_id=p_user for update;
 if not coalesce(s.enabled and s.free_plan_confirmed,false) then return 'Enable the assistant in Settings to find topics.'; end if;
 if s.provider_retry_until>now() then return 'Waiting for Groq to accept requests.'; end if;
 if exists(select from public.assistant_usage where user_id=p_user and usage_day=day and requests>=s.daily_limit)
 then return 'Daily allowance reached. Processing resumes after midnight in Vancouver.'; end if;
 if p_budget not between 1000 and 8000 or exists(select from public.assistant_request_limits where user_id=p_user and state='pending' and created_at>now()-interval '120 seconds')
 or (select coalesce(sum(coalesce(actual_tokens,budget)),0) from public.assistant_request_limits where user_id=p_user and created_at>now()-interval '61 seconds')+p_budget>8000
 then return 'Waiting for the next free request window.'; end if;
 update public.canvas_documents set topic_attempt_at=now() where user_id=p_user and course_canvas_id=p_course and canvas_file_id=p_file and state='ready' and source_version=p_version and (topic_version is distinct from p_version or not topics_complete) and (case when topic_version=p_version then topic_cursor else 0 end)=p_cursor;
 if not found then return 'The file changed. Processing will resume.'; end if;
 insert into public.assistant_usage(user_id,usage_day,requests,reserved_tokens) values(p_user,day,1,p_budget)
 on conflict(user_id,usage_day) do update set requests=assistant_usage.requests+1,reserved_tokens=assistant_usage.reserved_tokens+p_budget;
 insert into public.assistant_request_limits(id,user_id,budget,state) values(p_request,p_user,p_budget,'pending');
 return null;
end$$;
create function public.finish_topic_excerpt(p_user uuid,p_course uuid,p_canvas text,p_file text,p_version text,p_cursor int,p_topics jsonb,p_folder text)
returns integer language plpgsql security definer set search_path='' as $$
declare d public.canvas_documents; t record; n int:=0;
begin
 if not public.canvas_worker_owner(p_user) then raise exception 'Unauthorized' using errcode='42501'; end if;
 perform 1 from public.courses where user_id=p_user and id=p_course for update;
 select * into d from public.canvas_documents where user_id=p_user and course_canvas_id=p_canvas and canvas_file_id=p_file for update;
 if not found or d.state<>'ready' or d.source_version<>p_version or (d.topic_version=p_version and (d.topics_complete or d.topic_cursor<>p_cursor))
 or not exists(select from public.canvas_mappings where user_id=p_user and resource_type='course' and canvas_id=p_canvas and local_id=p_course and conflict is null) then return 0; end if;
 for t in select * from jsonb_to_recordset(p_topics) as x(title text,section text) loop
 if not exists(select from public.study_topics where user_id=p_user and course_id=p_course and public.topic_key(title)=public.topic_key(t.title))
 and not exists(select from public.topic_suggestions where user_id=p_user and course_id=p_course and title_key=public.topic_key(t.title) and (state<>'dismissed' or source_key='canvas-file:'||p_file)) then
 insert into public.topic_suggestions(user_id,course_id,title,title_key,section,source_key,source_file,source_folder)
 values(p_user,p_course,t.title,public.topic_key(t.title),t.section,'canvas-file:'||p_file,d.title,p_folder) on conflict do nothing;
 if found then n:=n+1; end if;
 end if; end loop;
 update public.canvas_documents set topic_version=p_version,topic_cursor=p_cursor+1,topics_complete=not exists(select from public.canvas_document_chunks where user_id=p_user and course_canvas_id=p_canvas and canvas_file_id=p_file and chunk_index=p_cursor+1)
 where user_id=p_user and course_canvas_id=p_canvas and canvas_file_id=p_file;
 return n;
end$$;
create function public.review_topic_suggestions(p_course uuid,p_ids uuid[],p_add boolean) returns void language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid(); s public.topic_suggestions;
begin
 if owner is null or not public.is_approved_user() then raise exception 'Unauthorized' using errcode='42501'; end if;
 perform 1 from public.courses where user_id=owner and id=p_course for update;
 for s in select * from public.topic_suggestions where user_id=owner and course_id=p_course and id=any(p_ids) and state='suggested' for update loop
 if p_add and not exists(select from public.study_topics where user_id=owner and course_id=p_course and public.topic_key(title)=s.title_key) then
 insert into public.study_topics(user_id,course_id,title,section,source_key,source_file,source_folder)
 values(owner,p_course,s.title,s.section,s.source_key,s.source_file,s.source_folder);
 end if;
 update public.topic_suggestions set state=case when p_add then 'added' else 'dismissed' end where id=s.id;
 end loop;
end$$;
revoke all on function public.next_topic_excerpt(uuid,uuid),public.reserve_topic_excerpt(uuid,uuid,int,text,text,text,int),public.finish_topic_excerpt(uuid,uuid,text,text,text,int,jsonb,text) from public,anon,authenticated;
grant execute on function public.next_topic_excerpt(uuid,uuid),public.reserve_topic_excerpt(uuid,uuid,int,text,text,text,int),public.finish_topic_excerpt(uuid,uuid,text,text,text,int,jsonb,text) to service_role;
revoke all on function public.review_topic_suggestions(uuid,uuid[],boolean) from public,anon;
grant execute on function public.review_topic_suggestions(uuid,uuid[],boolean) to authenticated;
