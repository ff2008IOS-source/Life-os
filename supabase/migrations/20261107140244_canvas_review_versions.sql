-- Review approval is conditional on both the Canvas snapshot (inside canvas_accept)
-- and the native record version. Concurrent owner edits must prompt a fresh review.
create function public.canvas_accept_versioned(p_user uuid,p_type text,p_id text,p_target uuid,p_expected_version integer,p_values jsonb,p_source jsonb)returns void language plpgsql security invoker set search_path='' as $$
declare v integer;
begin
 if not exists(select 1 from private.approved_users where user_id=p_user)then raise exception 'Unapproved owner' using errcode='42501';end if;
 if p_type='course' then select version into v from public.courses where user_id=p_user and id=p_target for update;
 elsif p_type='assignment' then select version into v from public.assessments where user_id=p_user and id=p_target for update;
 elsif p_type='assignment_group' then select version into v from public.grading_categories where user_id=p_user and id=p_target for update;
 else raise exception 'Unsupported Canvas review' using errcode='22023';end if;
 if v is null then raise exception 'Owned review target not found' using errcode='42501';end if;
 if p_expected_version is null or v<>p_expected_version then raise exception 'Life OS changed since this review. Reload the values before confirming.' using errcode='40001';end if;
 perform public.canvas_accept(p_user,p_type,p_id,p_target,p_values,p_source);
end$$;
revoke all on function public.canvas_accept_versioned(uuid,text,text,uuid,integer,jsonb,jsonb)from public,anon,authenticated;
grant execute on function public.canvas_accept_versioned(uuid,text,text,uuid,integer,jsonb,jsonb)to service_role;
