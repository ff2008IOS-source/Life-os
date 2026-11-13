-- Additive owner-only state. Existing conversations and review rows are unchanged.
alter table public.profiles add column avatar_data_url text check(avatar_data_url is null or (length(avatar_data_url)<=45000 and avatar_data_url ~ '^data:image/(jpeg|png|webp);base64,'));
create table public.briefing_settings(user_id uuid primary key references auth.users(id)on delete cascade,settings jsonb not null default '{}',updated_at timestamptz not null default now(),version integer not null default 1,check(jsonb_typeof(settings)='object'and octet_length(settings::text)<=4000));
create table public.daily_check_ins(user_id uuid not null references auth.users(id)on delete cascade,day date not null,timezone text not null default 'America/Vancouver',accomplishments text not null default '' check(length(accomplishments)<=2000),obstacles text not null default '' check(length(obstacles)<=2000),unfinished_commitments text not null default '' check(length(unfinished_commitments)<=2000),follow_up text not null default '' check(length(follow_up)<=2000),task_id uuid,goal_id uuid,status text not null default 'draft'check(status in ('draft','completed','skipped')),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),version integer not null default 1,primary key(user_id,day),foreign key(user_id,task_id)references public.tasks(user_id,id),foreign key(user_id,goal_id)references public.goals(user_id,id));
create table public.briefing_actions(user_id uuid not null references auth.users(id)on delete cascade,id uuid not null,kind text not null check(kind in ('defer','snooze','dismiss')),task_id uuid,item_key text not null check(length(item_key)between 1 and 300),fingerprint text not null check(length(fingerprint)<=4000),until_at timestamptz,created_at timestamptz not null default now(),primary key(user_id,id),foreign key(user_id,task_id)references public.tasks(user_id,id)on delete cascade,check(kind<>'defer' or task_id is not null));
create index briefing_actions_owner_time on public.briefing_actions(user_id,created_at desc);
create trigger briefing_settings_stamp before update on public.briefing_settings for each row execute function public.stamp_record();
create trigger check_in_stamp before update on public.daily_check_ins for each row execute function public.stamp_record();
do $$declare t text;begin foreach t in array array['briefing_settings','daily_check_ins','briefing_actions']loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select,insert,update,delete on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create policy owner_records on public.%I for all to authenticated using(user_id=(select auth.uid())and public.is_approved_user())with check(user_id=(select auth.uid())and public.is_approved_user())',t);
end loop;end$$;
create index check_in_owned_task on public.daily_check_ins(user_id,task_id);
create index check_in_owned_goal on public.daily_check_ins(user_id,goal_id);
create index briefing_actions_owned_task on public.briefing_actions(user_id,task_id);
