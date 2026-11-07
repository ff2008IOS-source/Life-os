-- First supported vertical slice: stable-ID project status mappings. Existing
-- workbooks remain read-only; provider writes require a separately verified guard.
create table public.sheet_sync_sources(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id)on delete cascade,connection_id uuid not null,
 spreadsheet_id text not null check(spreadsheet_id~'^[A-Za-z0-9_-]{10,200}$'),title text not null,
 mode text not null default 'import_only'check(mode in('import_only','export_only','two_way','paused')),
 write_authorized_at timestamptz,conditional_write_verified_at timestamptz,last_success_at timestamptz,last_error text,next_sync_at timestamptz not null default now(),version integer not null default 1,
 unique(user_id,id),unique(user_id,spreadsheet_id),foreign key(user_id,connection_id)references public.calendar_connections(user_id,id),
 check(mode in('import_only','paused')or(write_authorized_at is not null and conditional_write_verified_at is not null))
);
create table public.sheet_sync_mappings(
 id uuid primary key default gen_random_uuid(),user_id uuid not null,source_id uuid not null,sheet_id integer not null check(sheet_id>=0),external_id text not null check(length(external_id)between 1 and 200),
 id_column text not null,status_column text not null,project_id uuid not null,
 remote_values jsonb not null check(jsonb_typeof(remote_values)='object'),baseline text not null check(baseline in('active','paused','completed','cancelled')),
 remote_value text not null,last_row integer,last_success_at timestamptz,conflict jsonb,version integer not null default 1,
 unique(user_id,id),unique(user_id,source_id,sheet_id,external_id),unique(user_id,project_id),
 foreign key(user_id,source_id)references public.sheet_sync_sources(user_id,id)on delete cascade,foreign key(user_id,project_id)references public.projects(user_id,id)on delete cascade
);
create table public.sheet_sync_outbox(
 id uuid primary key default gen_random_uuid(),user_id uuid not null,mapping_id uuid not null,local_version integer not null,intended_status text not null,expected_remote_value text not null,
 status text not null default 'pending'check(status in('pending','confirmed','conflict','failed','superseded')),attempts integer not null default 0,next_attempt_at timestamptz not null default now(),last_error text,created_at timestamptz not null default now(),
 unique(user_id,mapping_id,local_version),foreign key(user_id,mapping_id)references public.sheet_sync_mappings(user_id,id)on delete cascade
);
do $$declare t text;begin foreach t in array array['sheet_sync_sources','sheet_sync_mappings','sheet_sync_outbox']loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);execute format('grant all on public.%I to service_role',t);execute format('create policy owner_read on public.%I for select to authenticated using(user_id=auth.uid()and public.is_approved_user())',t);
end loop;end$$;
create index sheet_pending_outbox on public.sheet_sync_outbox(user_id,next_attempt_at)where status='pending';
create function private.queue_project_sheet_status()returns trigger language plpgsql security definer set search_path=''as $$
declare m public.sheet_sync_mappings;begin
 if new.status is not distinct from old.status then return new;end if;
 for m in select x.* from public.sheet_sync_mappings x join public.sheet_sync_sources s on s.user_id=x.user_id and s.id=x.source_id where x.user_id=new.user_id and x.project_id=new.id and s.mode in('export_only','two_way')and s.write_authorized_at is not null and s.conditional_write_verified_at is not null and x.baseline<>new.status and x.conflict is null loop
  insert into public.sheet_sync_outbox(user_id,mapping_id,local_version,intended_status,expected_remote_value)values(new.user_id,m.id,new.version,new.status,m.remote_value)on conflict do nothing;
 end loop;return new;
end$$;
revoke all on function private.queue_project_sheet_status()from public,anon,authenticated;
create trigger project_sheet_outbox after update on public.projects for each row execute function private.queue_project_sheet_status();
create function public.accept_sheet_status(p_user uuid,p_mapping uuid,p_mapping_version integer,p_project_version integer,p_remote_status text,p_remote_value text,p_row integer,p_formula boolean,p_missing boolean,p_confirm boolean default false)returns text language plpgsql security invoker set search_path=''as $$
declare m public.sheet_sync_mappings;p public.projects;s public.sheet_sync_sources;begin
 if not exists(select 1 from private.approved_users where user_id=p_user)then raise exception 'Unapproved owner'using errcode='42501';end if;
 select * into m from public.sheet_sync_mappings where user_id=p_user and id=p_mapping;
 if not found then raise exception 'Owned mapping missing'using errcode='42501';end if;
 select * into p from public.projects where user_id=p_user and id=m.project_id for update;
 select * into m from public.sheet_sync_mappings where user_id=p_user and id=p_mapping for update;
 if m.project_id is distinct from p.id then raise exception 'Mapping changed'using errcode='40001';end if;
 select * into s from public.sheet_sync_sources where user_id=p_user and id=m.source_id for update;
 if s.mode not in('import_only','two_way')then raise exception 'Incoming synchronization is paused or export only'using errcode='42501';end if;
 if m.version<>p_mapping_version or p.version<>p_project_version then raise exception 'Mapping or project changed; sync again'using errcode='40001';end if;
 if p_missing or p_formula then
  update public.sheet_sync_mappings set conflict=jsonb_build_object('kind',case when p_missing then 'remote_missing'else 'formula_or_protected'end,'local',p.status,'base',m.baseline,'remote',p_remote_value,'project_version',p.version),version=version+1 where id=m.id;
  return 'conflict';
 end if;
 if p_remote_status is null or p_remote_status not in('active','paused','completed','cancelled')or p_remote_value is distinct from m.remote_values->>p_remote_status then raise exception 'Unmapped source status'using errcode='22023';end if;
 if not p_confirm and p.status<>m.baseline and p_remote_status<>m.baseline and p.status<>p_remote_status then
  update public.sheet_sync_mappings set conflict=jsonb_build_object('kind','concurrent_edit','local',p.status,'base',m.baseline,'remote',p_remote_value,'remote_status',p_remote_status,'project_version',p.version),version=version+1 where id=m.id;
  return 'conflict';
 end if;
 if p.status<>m.baseline and p_remote_status=m.baseline and not p_confirm then
  update public.sheet_sync_mappings set last_success_at=now(),last_row=p_row,remote_value=p_remote_value,version=version+1 where id=m.id;
  return 'local_preserved';
 end if;
 -- Establish the new confirmed baseline before changing the project. The trigger
 -- sees matching values and cannot enqueue an echo back to Google Sheets.
 update public.sheet_sync_mappings set baseline=p_remote_status,remote_value=p_remote_value,last_row=p_row,last_success_at=now(),conflict=null,version=version+1 where id=m.id;
 if p.status<>p_remote_status then update public.projects set status=p_remote_status where user_id=p_user and id=p.id;end if;
 update public.sheet_sync_outbox set status=case when intended_status=p_remote_status then 'confirmed'else 'superseded'end where user_id=p_user and mapping_id=m.id and status='pending';
 return 'synced';
end$$;
revoke all on function public.accept_sheet_status(uuid,uuid,integer,integer,text,text,integer,boolean,boolean,boolean)from public,anon,authenticated;
grant execute on function public.accept_sheet_status(uuid,uuid,integer,integer,text,text,integer,boolean,boolean,boolean)to service_role;
