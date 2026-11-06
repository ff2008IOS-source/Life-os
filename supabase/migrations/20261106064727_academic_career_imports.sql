-- Unknown academic term dates and source-reported assessment values remain explicit.
alter table public.academic_terms alter column start_date drop not null,alter column end_date drop not null;
alter table public.assessments add column notes text not null default '',add column score_unit text not null default 'points' check(score_unit in ('points','percent')),add column source_status text;
alter table public.grading_categories add column aggregation text not null default 'unknown' check(aggregation in ('unknown','points','equal_items','assessment_weights'));
alter table public.study_sessions add column actual_minutes integer check(actual_minutes>0);
alter table public.contacts add column last_contact_at timestamptz;
alter table public.courses add column source_key text,add unique(user_id,source_id,source_key);
alter table public.study_topics add column source_id uuid,add column source_key text,add foreign key(user_id,source_id) references public.data_sources(user_id,id),add unique(user_id,source_id,source_key);
alter table public.goals add column source_id uuid,add column source_key text,add foreign key(user_id,source_id) references public.data_sources(user_id,id),add unique(user_id,source_id,source_key);
alter table public.projects add column source_id uuid,add column source_key text,add foreign key(user_id,source_id) references public.data_sources(user_id,id),add unique(user_id,source_id,source_key);
create table public.career_entries(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('contact','skill','application_target','roadmap','career_goal','portfolio_project','review')),
 title text not null,status text not null default 'unknown',details jsonb not null default '{}',source_id uuid,source_key text,verification_status text not null default 'unverified' check(verification_status in ('unverified','user_confirmed','verified')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),version integer not null default 1,
 unique(user_id,id),foreign key(user_id,source_id) references public.data_sources(user_id,id),unique(user_id,source_id,source_key)
);
alter table public.career_entries enable row level security;
revoke all on public.career_entries from public,anon,authenticated;
grant select,insert,update,delete on public.career_entries to authenticated;
grant all on public.career_entries to service_role;
create policy own_records on public.career_entries for all to authenticated using(user_id=auth.uid() and public.is_approved_user()) with check(user_id=auth.uid() and public.is_approved_user());
create index career_entries_owner on public.career_entries(user_id);
create trigger stamp before update on public.career_entries for each row execute function public.stamp_record();
create trigger audit after insert or update or delete on public.career_entries for each row execute function public.audit_record();

-- Atomic import from a server-created preview; browser clients cannot edit job payloads.
create function public.apply_career_import(p_user uuid,p_job uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare job public.integration_jobs; n integer;
begin
 if not exists(select 1 from private.approved_users where user_id=p_user) then raise exception 'Unapproved user';end if;
 select * into job from public.integration_jobs where id=p_job and user_id=p_user and job_type='career_import_preview' for update;
 if not found or job.status<>'pending' or job.next_attempt_at<now() then raise exception 'Preview expired or applied';end if;
 insert into public.career_entries(user_id,kind,title,status,details,source_id,source_key)
 select p_user,x.kind,x.title,x.status,x.details,(job.payload->>'source_id')::uuid,x.source_key
 from jsonb_to_recordset(job.payload->'records') as x(kind text,title text,status text,details jsonb,source_key text)
 on conflict(user_id,source_id,source_key) do nothing;
 get diagnostics n=row_count;
 insert into public.import_batches(user_id,source_id,status,mapping_version,schema_fingerprint,started_at,finished_at,imported_count)
 values(p_user,(job.payload->>'source_id')::uuid,'completed',1,job.payload->>'schemaFingerprint',now(),now(),n);
 update public.integration_jobs set status='completed' where id=p_job and user_id=p_user;
 return n;
end $$;
revoke all on function public.apply_career_import(uuid,uuid) from public,anon,authenticated;
grant execute on function public.apply_career_import(uuid,uuid) to service_role;

create function public.apply_academic_import(p_user uuid,p_job uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare job public.integration_jobs; source uuid; n integer:=0; affected integer;
begin
 if not exists(select 1 from private.approved_users where user_id=p_user) then raise exception 'Unapproved user';end if;
 select * into job from public.integration_jobs where user_id=p_user and id=p_job and job_type='academic_import_preview' for update;
 if not found or job.status<>'pending' or job.next_attempt_at<now() then raise exception 'Preview expired or applied';end if;
 source:=(job.payload->>'source_id')::uuid;
 insert into public.academic_terms(id,user_id,name,start_date,end_date)
 select x.id,p_user,x.name,null,null from jsonb_to_recordset(job.payload->'mapped'->'terms') as x(id uuid,name text)
 on conflict do nothing;
 get diagnostics affected=row_count;n:=n+affected;
 insert into public.courses(id,user_id,term_id,code,title,description,grading_method,verification_status,source_id,source_key)
 select x.id,p_user,x.term_id,x.code,x.title,x.description,'unknown','unverified',source,x.source_key
 from jsonb_to_recordset(job.payload->'mapped'->'courses') as x(id uuid,term_id uuid,code text,title text,description text,source_key text)
 on conflict do nothing;
 get diagnostics affected=row_count;n:=n+affected;
 insert into public.assessments(id,user_id,course_id,title,weight,maximum_score,earned_score,score_unit,submission_state,due_date,verification_status,source_status,notes,source_id,source_key)
 select x.id,p_user,x.course_id,x.title,x.weight,x.maximum_score,x.earned_score,'percent','unknown',x.due_date,'unverified',x.source_status,x.notes,source,x.source_key
 from jsonb_to_recordset(job.payload->'mapped'->'assessments') as x(id uuid,course_id uuid,title text,weight numeric,maximum_score numeric,earned_score numeric,due_date date,source_status text,notes text,source_key text)
 on conflict do nothing;
 get diagnostics affected=row_count;n:=n+affected;
 insert into public.study_topics(id,user_id,course_id,title,mastery,notes,source_id,source_key)
 select x.id,p_user,x.course_id,x.title,x.mastery,x.notes,source,x.source_key
 from jsonb_to_recordset(job.payload->'mapped'->'topics') as x(id uuid,course_id uuid,title text,mastery text,notes text,source_key text)
 on conflict do nothing;
 get diagnostics affected=row_count;n:=n+affected;
 insert into public.import_batches(user_id,source_id,status,mapping_version,started_at,finished_at,imported_count) values(p_user,source,'completed',1,now(),now(),n);
 update public.integration_jobs set status='completed' where user_id=p_user and id=p_job;
 return n;
end $$;
revoke all on function public.apply_academic_import(uuid,uuid) from public,anon,authenticated;
grant execute on function public.apply_academic_import(uuid,uuid) to service_role;
