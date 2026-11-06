-- Explicitly requested synthetic beta examples. No real user context is seeded.
create function public.add_beta_examples() returns void language plpgsql set search_path = '' as $$
declare area uuid; project uuid; goal uuid;
begin
 if auth.uid() is null or not public.is_approved_user() then raise exception 'Not authorized' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,1));
 perform public.initialize_workspace();
 select id into area from public.life_areas where user_id=auth.uid() and slug='projects';
 select id into project from public.projects where user_id=auth.uid() and name='[TEST] A sample project' limit 1;
 if project is null then insert into public.projects(user_id,area_id,name,description) values(auth.uid(),area,'[TEST] A sample project','Synthetic beta example. Not a real commitment.') returning id into project; end if;
 select id into goal from public.goals where user_id=auth.uid() and title='[TEST] Explore a complete workflow' limit 1;
 if goal is null then insert into public.goals(user_id,area_id,title,description,progress_type) values(auth.uid(),area,'[TEST] Explore a complete workflow','Synthetic beta example. Edit, link tasks, and add a milestone.','milestone') returning id into goal;
 insert into public.milestones(user_id,goal_id,project_id,title) values(auth.uid(),goal,project,'[TEST] Finish the beta walkthrough'); end if;
 insert into public.tasks(user_id,area_id,project_id,title,description,status,estimated_minutes,scheduling_mode,source_type,source_key)
 values(auth.uid(),area,project,'[TEST] Try completing a task','Synthetic beta task. No real deadline.','inbox',30,'manual','test','beta-task-1'),
 (auth.uid(),area,project,'[TEST] Preview a focused work session','Synthetic beta task. No real availability or calendar writes.','planned',60,'eligible','test','beta-task-2') on conflict(user_id,source_type,source_key) do nothing;
 insert into public.goal_tasks(user_id,goal_id,task_id) select auth.uid(),goal,id from public.tasks where user_id=auth.uid() and source_type='test' and source_key in ('beta-task-1','beta-task-2') on conflict do nothing;
end; $$;
revoke all on function public.add_beta_examples() from public;
grant execute on function public.add_beta_examples() to authenticated;
