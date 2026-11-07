-- Persist the Canvas account identity across token removal/replacement to prevent mixed-student grades.
alter table public.canvas_token_attempts add column canvas_user_id text;
create function public.canvas_bind_identity(p_user uuid,p_canvas text)returns boolean language plpgsql security invoker set search_path='' as $$begin
 if p_canvas !~ '^[0-9]+$' then raise exception 'Invalid Canvas account';end if;
 update public.canvas_token_attempts set canvas_user_id=p_canvas where user_id=p_user and(canvas_user_id is null or canvas_user_id=p_canvas);return found;end$$;
revoke all on function public.canvas_bind_identity(uuid,text) from public,anon,authenticated;
grant execute on function public.canvas_bind_identity(uuid,text) to service_role;
create function public.canvas_resume_jobs(p_user uuid)returns void language sql security invoker set search_path='' as $$update public.canvas_sync_jobs set last_error=null,attempts=0,next_run_at=now()where user_id=p_user$$;
revoke all on function public.canvas_resume_jobs(uuid) from public,anon,authenticated;
grant execute on function public.canvas_resume_jobs(uuid) to service_role;
