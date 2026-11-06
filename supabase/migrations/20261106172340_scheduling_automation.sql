create table public.scheduling_automation (
 id uuid primary key default gen_random_uuid(),user_id uuid not null unique references auth.users(id) on delete cascade,
 enabled boolean not null default false,policy jsonb not null default '{}',last_checked_at timestamptz,last_status text,last_error text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),version integer not null default 1,unique(user_id,id)
);
alter table public.scheduling_automation enable row level security;
revoke all on public.scheduling_automation from public,anon,authenticated;
grant select on public.scheduling_automation to authenticated;
grant all on public.scheduling_automation to service_role;
create policy own_records on public.scheduling_automation for select to authenticated using(user_id=auth.uid() and public.is_approved_user());
create trigger stamp before update on public.scheduling_automation for each row execute function public.stamp_record();
