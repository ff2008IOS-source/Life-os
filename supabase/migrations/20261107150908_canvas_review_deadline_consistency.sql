-- Use the same source-first lock order as ingestion. Approval updates only
-- unchanged source-linked task deadlines; user overrides and work history stay intact.
create or replace function public.canvas_accept_versioned(p_user uuid,p_type text,p_id text,p_target uuid,p_expected_version integer,p_values jsonb,p_source jsonb)returns void language plpgsql security invoker set search_path=''as $$
declare v integer;a public.assessments;t public.tasks;
begin
 if not exists(select 1 from private.approved_users where user_id=p_user)then raise exception 'Unapproved owner'using errcode='42501';end if;
 perform 1 from public.canvas_records where user_id=p_user and resource_type=p_type and canvas_id=p_id and payload=p_source for update;
 if not found then raise exception 'Canvas source changed; review again'using errcode='40001';end if;
 if p_type='course'then select version into v from public.courses where user_id=p_user and id=p_target for update;
 elsif p_type='assignment'then select * into a from public.assessments where user_id=p_user and id=p_target for update;v:=a.version;
 elsif p_type='assignment_group'then select version into v from public.grading_categories where user_id=p_user and id=p_target for update;
 else raise exception 'Unsupported Canvas review'using errcode='22023';end if;
 if v is null then raise exception 'Owned review target not found'using errcode='42501';end if;
 if p_expected_version is null or v<>p_expected_version then raise exception 'Life OS changed since this review. Reload the values before confirming.'using errcode='40001';end if;
 if p_type='assignment'and a.task_id is not null then select * into t from public.tasks where user_id=p_user and id=a.task_id for update;end if;
 perform public.canvas_accept(p_user,p_type,p_id,p_target,p_values,p_source);
 if t.id is not null and t.due_at is not distinct from a.due_at and t.due_date is not distinct from a.due_date then
  update public.tasks set due_at=(p_values->>'due_at')::timestamptz,due_date=null where user_id=p_user and id=t.id and(due_at is distinct from(p_values->>'due_at')::timestamptz or due_date is not null);
 end if;
end$$;
revoke all on function public.canvas_accept_versioned(uuid,text,text,uuid,integer,jsonb,jsonb)from public,anon,authenticated;
grant execute on function public.canvas_accept_versioned(uuid,text,text,uuid,integer,jsonb,jsonb)to service_role;
