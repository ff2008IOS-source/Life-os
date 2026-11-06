-- Life OS beta A. No real records, credentials, or provider writes.
create schema if not exists private;
revoke all on schema private from public;
create table private.approved_users (user_id uuid primary key references auth.users(id) on delete cascade);
revoke all on private.approved_users from public, anon, authenticated;
alter table private.approved_users enable row level security;
create or replace function public.is_approved_user() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from private.approved_users where user_id = auth.uid());
$$;
revoke all on function public.is_approved_user() from public;
grant execute on function public.is_approved_user() to authenticated;

create table public.profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '', timezone text not null default 'America/Vancouver', locale text not null default 'en-CA',
 theme text not null default 'dark' check (theme in ('dark','light','system')), density text not null default 'comfortable' check (density in ('comfortable','compact')),
 onboarding_completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1
);
create table public.life_areas (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 name text not null, slug text not null, icon text not null default 'folder', color text not null default '#407BEE', sort_order integer not null default 0, archived_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id), unique(user_id,slug)
);
create table public.projects (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 area_id uuid, name text not null check(length(trim(name)) between 1 and 200), description text not null default '',
 status text not null default 'active' check(status in ('active','paused','completed','cancelled')), start_date date, target_date date, archived_at timestamptz,
 automation_enabled boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id), foreign key(user_id,area_id) references public.life_areas(user_id,id), check(target_date is null or start_date is null or target_date >= start_date)
);
create table public.goals (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 area_id uuid, parent_goal_id uuid, title text not null check(length(trim(title)) between 1 and 200), description text not null default '',
 progress_type text not null default 'milestone' check(progress_type in ('numeric','milestone','binary','qualitative')),
 target_value numeric, current_value numeric, unit text, start_date date, target_date date,
 status text not null default 'active' check(status in ('active','paused','completed','cancelled')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id), foreign key(user_id,area_id) references public.life_areas(user_id,id), foreign key(user_id,parent_goal_id) references public.goals(user_id,id),
 check(parent_goal_id is distinct from id), check(progress_type <> 'qualitative' or (target_value is null and current_value is null)),
 check(progress_type <> 'numeric' or target_value > 0), check(target_date is null or start_date is null or target_date >= start_date)
);
create table public.milestones (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 goal_id uuid, project_id uuid, title text not null check(length(trim(title)) between 1 and 200), target_date date,
 status text not null default 'planned' check(status in ('planned','completed','cancelled')), completed_at timestamptz, evidence_url text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id), foreign key(user_id,goal_id) references public.goals(user_id,id), foreign key(user_id,project_id) references public.projects(user_id,id),
 check(goal_id is not null or project_id is not null), check((status = 'completed') = (completed_at is not null))
);
create table public.recurrence_rules (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 rrule text not null, timezone text not null default 'America/Vancouver', start_date date not null, end_date date, next_occurrence_at timestamptz,
 unique(user_id,id), check(end_date is null or end_date >= start_date)
);
create table public.tasks (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 area_id uuid, project_id uuid, parent_task_id uuid, recurrence_rule_id uuid,
 title text not null check(length(trim(title)) between 1 and 200), description text not null default '',
 status text not null default 'inbox' check(status in ('inbox','planned','in_progress','completed','cancelled')),
 priority integer not null default 2 check(priority between 1 and 4), due_at timestamptz, due_date date, due_timezone text not null default 'America/Vancouver',
 estimated_minutes integer check(estimated_minutes between 1 and 100000), actual_minutes integer check(actual_minutes >= 0),
 scheduling_mode text not null default 'manual' check(scheduling_mode in ('manual','eligible')),
 completed_at timestamptz, source_type text not null default 'user', source_key text,
 priority_order integer, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1, deleted_at timestamptz,
 unique(user_id,id), unique(user_id,source_type,source_key),
 foreign key(user_id,area_id) references public.life_areas(user_id,id), foreign key(user_id,project_id) references public.projects(user_id,id),
 foreign key(user_id,parent_task_id) references public.tasks(user_id,id), foreign key(user_id,recurrence_rule_id) references public.recurrence_rules(user_id,id),
 check(due_at is null or due_date is null), check(parent_task_id is distinct from id), check((status = 'completed') = (completed_at is not null))
);
create table public.task_dependencies (
 user_id uuid not null references auth.users(id) on delete cascade, predecessor_task_id uuid not null, successor_task_id uuid not null,
 dependency_type text not null default 'finish_to_start' check(dependency_type = 'finish_to_start'),
 primary key(user_id,predecessor_task_id,successor_task_id), check(predecessor_task_id <> successor_task_id),
 foreign key(user_id,predecessor_task_id) references public.tasks(user_id,id) on delete cascade,
 foreign key(user_id,successor_task_id) references public.tasks(user_id,id) on delete cascade
);
create function public.reject_dependency_cycle() returns trigger language plpgsql set search_path = '' as $$
begin
 -- Serialize graph mutations per user to prevent concurrent cycle creation.
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
 if exists(with recursive descendants(id) as (
 select successor_task_id from public.task_dependencies where user_id = new.user_id and predecessor_task_id = new.successor_task_id
 union select d.successor_task_id from public.task_dependencies d join descendants x on d.predecessor_task_id = x.id where d.user_id = new.user_id
 ) select 1 from descendants where id = new.predecessor_task_id) then raise exception 'Circular dependency' using errcode = '23514'; end if;
 return new;
end; $$;
create trigger dependency_cycle before insert or update on public.task_dependencies for each row execute function public.reject_dependency_cycle();
create table public.task_occurrences (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, task_id uuid not null,
 occurrence_key text not null, scheduled_date date not null, status text not null default 'planned' check(status in ('planned','completed','cancelled')),
 completed_at timestamptz, unique(user_id,id), unique(user_id,task_id,occurrence_key),
 foreign key(user_id,task_id) references public.tasks(user_id,id) on delete cascade,
 check((status = 'completed') = (completed_at is not null))
);
create table public.goal_tasks (
 user_id uuid not null references auth.users(id) on delete cascade, goal_id uuid not null, task_id uuid not null,
 primary key(user_id,goal_id,task_id), foreign key(user_id,goal_id) references public.goals(user_id,id) on delete cascade, foreign key(user_id,task_id) references public.tasks(user_id,id) on delete cascade
);
create table public.reviews (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 period_start date not null, period_end date not null, completed_at timestamptz,
 achievements text not null default '', obstacles text not null default '', missed_commitments text not null default '', decisions text not null default '', priorities text not null default '',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id), unique(user_id,period_start), check(period_end >= period_start)
);
create table public.audit_logs (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 entity_type text not null, entity_id uuid not null, action text not null, old_values jsonb, new_values jsonb, created_at timestamptz not null default now()
);
create function public.stamp_record() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); new.version = old.version + 1; return new; end; $$;
create function public.audit_record() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.audit_logs(user_id,entity_type,entity_id,action,old_values,new_values)
 values(coalesce(new.user_id,old.user_id),tg_table_name,coalesce(new.id,old.id),tg_op,
 case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
 return coalesce(new,old);
end; $$;
-- Private data tables are deny-by-default to anonymous users.
do $$ declare t text; begin
 foreach t in array array['profiles','life_areas','projects','goals','milestones','tasks','recurrence_rules','task_dependencies','task_occurrences','goal_tasks','reviews','audit_logs'] loop
 execute format('revoke all on public.%I from public, anon, authenticated',t);
 execute format('alter table public.%I enable row level security',t);
 if t = 'audit_logs' then
 execute format('create policy own_records on public.%I for select to authenticated using (user_id = auth.uid() and public.is_approved_user())',t);
 else
 execute format('create policy own_records on public.%I for all to authenticated using (user_id = auth.uid() and public.is_approved_user()) with check (user_id = auth.uid() and public.is_approved_user())',t);
 end if;
 execute format('grant select on public.%I to authenticated',t);
 if t <> 'audit_logs' then execute format('grant insert,update,delete on public.%I to authenticated',t); end if;
 end loop;
 foreach t in array array['profiles','life_areas','projects','goals','milestones','tasks','reviews'] loop
 execute format('create trigger stamp before update on public.%I for each row execute function public.stamp_record()',t);
 end loop;
 foreach t in array array['tasks','projects','goals','milestones','reviews'] loop
 execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.audit_record()',t);
 end loop;
end $$;
create index tasks_active_due on public.tasks(user_id,due_date,due_at) where deleted_at is null and status not in ('completed','cancelled');
create index tasks_project on public.tasks(user_id,project_id);
create index tasks_area on public.tasks(user_id,area_id);
create index tasks_completion on public.tasks(user_id,completed_at);
create index milestones_goal on public.milestones(user_id,goal_id);
create index audit_user_created on public.audit_logs(user_id,created_at desc);

create function public.initialize_workspace() returns void language plpgsql set search_path = '' as $$
begin
 if auth.uid() is null or not public.is_approved_user() then raise exception 'Not authorized' using errcode = '42501'; end if;
 insert into public.profiles(user_id) values(auth.uid()) on conflict do nothing;
 insert into public.life_areas(user_id,name,slug,icon,color,sort_order) values
 (auth.uid(),'Academics','academics','graduation-cap','#799BFF',0),
 (auth.uid(),'Career','career','briefcase','#B99BFA',1),
 (auth.uid(),'Projects','projects','layers','#56C6BD',2),
 (auth.uid(),'Finances','finances','wallet','#E6A34A',3),
 (auth.uid(),'Wellbeing','wellbeing','heart','#E68FA5',4)
 on conflict(user_id,slug) do nothing;
end; $$;
revoke all on function public.initialize_workspace() from public;
grant execute on function public.initialize_workspace() to authenticated;
