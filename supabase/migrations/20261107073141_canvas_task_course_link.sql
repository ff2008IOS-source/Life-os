-- Link newly captured Canvas work to its existing owned course. Existing tasks are preserved.
create or replace function public.canvas_create_task(p_user uuid,p_id text)returns uuid language plpgsql security invoker set search_path='' as $$declare a public.assessments;tid uuid;area uuid;begin
 select x.* into a from public.assessments x join public.canvas_mappings m on m.user_id=x.user_id and m.local_id=x.id and m.resource_type='assignment' where x.user_id=p_user and m.canvas_id=p_id and m.conflict is null for update of x;
 if not found then raise exception 'Reconcile the assessment before adding it to Planner';end if;
 if a.task_id is not null then return a.task_id;end if;
 select id into area from public.life_areas where user_id=p_user and slug='academics';
 insert into public.tasks(user_id,title,description,area_id,course_id,due_at,due_date,scheduling_mode)values(p_user,left(a.title,200),'Canvas-linked academic responsibility. Add an effort estimate before opting into scheduling.',area,a.course_id,a.due_at,a.due_date,'manual')returning id into tid;
 update public.assessments set task_id=tid where user_id=p_user and id=a.id;return tid;end$$;
revoke all on function public.canvas_create_task(uuid,text) from public,anon,authenticated;
grant execute on function public.canvas_create_task(uuid,text) to service_role;
