-- Generic row ledger. Existing career imports and personal-calendar permissions are unchanged.
create table public.sheet_rest_datasets(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id)on delete cascade,connection_id uuid not null,source_id uuid not null,
 spreadsheet_id text not null check(spreadsheet_id~'^[A-Za-z0-9_-]{10,200}$'),worksheet_id integer not null check(worksheet_id>=0),title text not null,worksheet_title text not null,config jsonb not null check(jsonb_typeof(config)='object'),
 mode text not null default 'import_only'check(mode in('import_only','export_only','two_way','paused')),
 test_only boolean not null default false,outbound_enabled boolean not null default false,automatic_outbound boolean not null default false,production_approved_at timestamptz,
 last_read_at timestamptz,last_write_at timestamptz,last_hash text,last_error text,last_error_code text,next_sync_at timestamptz not null default now(),attempts integer not null default 0,
 lease_token uuid,lease_until timestamptz,last_attempt_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),version integer not null default 1,
 unique(user_id,id),foreign key(user_id,connection_id)references public.calendar_connections(user_id,id),foreign key(user_id,source_id)references public.data_sources(user_id,id),
 check(not outbound_enabled or test_only or production_approved_at is not null),check(not automatic_outbound or outbound_enabled)
);
create table public.sheet_rest_rows(
 id uuid primary key default gen_random_uuid(),user_id uuid not null,dataset_id uuid not null,external_key text not null,key_values jsonb not null,
 row_locator integer,baseline jsonb not null default '{}',remote_cells jsonb not null default '{}',local_values jsonb not null default '{}',conflicts jsonb not null default '{}',
 remote_hash text,remote_missing boolean not null default false,state text not null default 'synced'check(state in('synced','pending','conflict','source_missing','draft_new','deleted')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),version integer not null default 1,
 unique(user_id,id),unique(user_id,dataset_id,id),unique(user_id,dataset_id,external_key),foreign key(user_id,dataset_id)references public.sheet_rest_datasets(user_id,id)on delete cascade
);
create table public.sheet_rest_operations(
 id uuid primary key,user_id uuid not null,dataset_id uuid not null,row_id uuid not null,operation_type text not null check(operation_type in('update','insert','delete')),
 intended jsonb not null,expected_cells jsonb not null,preflight jsonb,status text not null default 'draft'check(status in('draft','approved','writing','unknown','confirmed','conflict','failed','superseded')),
 approved_at timestamptz,attempts integer not null default 0,next_attempt_at timestamptz not null default now(),last_error text,provider_accepted boolean not null default false,verified_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),version integer not null default 1,
 unique(user_id,id),foreign key(user_id,dataset_id)references public.sheet_rest_datasets(user_id,id)on delete cascade,foreign key(user_id,dataset_id,row_id)references public.sheet_rest_rows(user_id,dataset_id,id)on delete cascade
);
create table public.sheet_rest_runs(
 id uuid primary key default gen_random_uuid(),user_id uuid not null,dataset_id uuid not null,status text not null check(status in('running','completed','partial','failed')),summary jsonb not null default '{}',last_error text,
 started_at timestamptz not null default now(),finished_at timestamptz,foreign key(user_id,dataset_id)references public.sheet_rest_datasets(user_id,id)on delete cascade
);
create table public.sheet_rest_tests(
 id uuid primary key,user_id uuid not null references auth.users(id)on delete cascade,connection_id uuid not null,spreadsheet_id text,spreadsheet_url text,dataset_id uuid,
 status text not null default 'intent'check(status in('intent','creating','ready','verified','unknown','failed')),results jsonb not null default '{}',last_error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(user_id,connection_id)references public.calendar_connections(user_id,id),foreign key(user_id,dataset_id)references public.sheet_rest_datasets(user_id,id)
);
create unique index sheet_rest_source_table on public.sheet_rest_datasets(user_id,spreadsheet_id,worksheet_id,(config->>'header_row'),(config->>'start_column'));
create index sheet_rest_due on public.sheet_rest_datasets(next_sync_at)where mode<>'paused';
create index sheet_rest_row_page on public.sheet_rest_rows(user_id,dataset_id,id);
create index sheet_rest_pending on public.sheet_rest_operations(user_id,dataset_id,next_attempt_at)where status in('approved','writing','unknown');
create index sheet_rest_run_history on public.sheet_rest_runs(user_id,dataset_id,started_at desc);
do $$declare t text;begin foreach t in array array['sheet_rest_datasets','sheet_rest_rows','sheet_rest_operations','sheet_rest_runs','sheet_rest_tests']loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create policy owner_read on public.%I for select to authenticated using(user_id=(select auth.uid())and public.is_approved_user())',t);
end loop;end$$;
do $$declare t text;begin foreach t in array array['sheet_rest_datasets','sheet_rest_rows','sheet_rest_operations']loop
 execute format('create trigger stamp before update on public.%I for each row execute function public.stamp_record()',t);
end loop;end$$;
-- Short transactions only. The durable lease spans HTTP operations; no row lock is held over Google calls.
create function public.claim_sheet_rest(p_user uuid,p_dataset uuid,p_lease uuid)returns boolean language plpgsql security invoker set search_path=''as $$
begin
 if not exists(select 1 from private.approved_users where user_id=p_user)then raise exception 'Unapproved owner'using errcode='42501';end if;
 update public.sheet_rest_datasets set lease_token=p_lease,lease_until=now()+interval '110 seconds',last_attempt_at=now()
 where user_id=p_user and id=p_dataset and mode<>'paused'and(lease_until is null or lease_until<now())and(test_only or last_attempt_at is null or last_attempt_at<now()-interval '10 seconds')and(last_error_code is distinct from 'RATE_LIMIT'or next_sync_at<=now());
 return found;
end$$;
create function public.ingest_sheet_rest(p_user uuid,p_dataset uuid,p_lease uuid,p_rows jsonb,p_hash text)returns integer language plpgsql security invoker set search_path=''as $$
declare d public.sheet_rest_datasets;r public.sheet_rest_rows;x jsonb;n integer:=0;begin
 select * into d from public.sheet_rest_datasets where user_id=p_user and id=p_dataset for update;
 if not found or d.lease_token is distinct from p_lease or d.lease_until<now()then raise exception 'Source lease expired'using errcode='40001';end if;
 if jsonb_typeof(p_rows)<>'array'or jsonb_array_length(p_rows)>5000 then raise exception 'Invalid bounded snapshot'using errcode='22023';end if;
 for x in select value from jsonb_array_elements(p_rows)loop
  select * into r from public.sheet_rest_rows where user_id=p_user and dataset_id=p_dataset and external_key=x->>'external_key'for update;
  if found then
   if r.version is distinct from(x->>'expected_version')::integer then raise exception 'Row changed during synchronization'using errcode='40001';end if;
   if r.baseline is distinct from x->'baseline'or r.local_values is distinct from x->'local_values'or r.remote_cells is distinct from x->'remote_cells'or r.conflicts is distinct from x->'conflicts'or r.remote_missing is distinct from(x->>'remote_missing')::boolean or r.row_locator is distinct from(x->>'row_locator')::integer or r.state is distinct from x->>'state' then
    insert into public.audit_logs(user_id,entity_type,entity_id,action,old_values,new_values)values(p_user,'sheet_rest_rows',r.id,'source_sync',jsonb_build_object('values',r.local_values,'hash',r.remote_hash,'missing',r.remote_missing),jsonb_build_object('values',x->'local_values','hash',x->'remote_hash','missing',x->'remote_missing'));
    update public.sheet_rest_rows set baseline=x->'baseline',local_values=x->'local_values',remote_cells=x->'remote_cells',conflicts=x->'conflicts',remote_hash=x->>'remote_hash',remote_missing=(x->>'remote_missing')::boolean,row_locator=(x->>'row_locator')::integer,state=x->>'state'where id=r.id;n:=n+1;
   end if;
  else
   if x->>'expected_version'is not null then raise exception 'Mapped row disappeared'using errcode='40001';end if;
   insert into public.sheet_rest_rows(id,user_id,dataset_id,external_key,key_values,row_locator,baseline,remote_cells,local_values,conflicts,remote_hash,remote_missing,state)values((x->>'id')::uuid,p_user,p_dataset,x->>'external_key',x->'key_values',(x->>'row_locator')::integer,x->'baseline',x->'remote_cells',x->'local_values',x->'conflicts',x->>'remote_hash',(x->>'remote_missing')::boolean,x->>'state');n:=n+1;
  end if;
 end loop;
 update public.sheet_rest_datasets set last_hash=p_hash,last_read_at=now(),last_error=null,last_error_code=null,attempts=0 where id=p_dataset;
 return n;
end$$;
create function public.edit_sheet_rest(p_user uuid,p_dataset uuid,p_row uuid,p_version integer,p_request uuid,p_type text,p_values jsonb,p_key text,p_key_values jsonb)returns uuid language plpgsql security invoker set search_path=''as $$
declare d public.sheet_rest_datasets;r public.sheet_rest_rows;o public.sheet_rest_operations;f text;c jsonb;v jsonb;begin
 if not exists(select 1 from private.approved_users where user_id=p_user)then raise exception 'Unapproved owner'using errcode='42501';end if;
 select * into d from public.sheet_rest_datasets where user_id=p_user and id=p_dataset for update;
 if not found then raise exception 'Owned dataset missing'using errcode='42501';end if;
 if d.lease_until>now()then raise exception 'Source synchronization is running'using errcode='55P03';end if;
 select * into o from public.sheet_rest_operations where user_id=p_user and id=p_request;
 if found then
  if o.dataset_id<>p_dataset or o.row_id<>p_row or o.intended<>p_values or o.operation_type<>p_type then raise exception 'Request identity reused'using errcode='40001';end if;return o.id;
 end if;
 if exists(select 1 from public.sheet_rest_operations where user_id=p_user and row_id=p_row and status in('writing','unknown'))then raise exception 'Reconcile the uncertain write before editing again'using errcode='40001';end if;
 if p_type not in('update','insert','delete')or jsonb_typeof(p_values)<>'object'then raise exception 'Invalid edit'using errcode='22023';end if;
 if p_type='insert'then
  if not coalesce((d.config->>'allow_insert')::boolean,false)or p_key is null or p_key_values is null then raise exception 'Insert is not authorized for this table'using errcode='42501';end if;
  insert into public.sheet_rest_rows(id,user_id,dataset_id,external_key,key_values,local_values,state)values(p_row,p_user,p_dataset,p_key,p_key_values,p_values,'draft_new')returning *into r;
 else
  select * into r from public.sheet_rest_rows where user_id=p_user and dataset_id=p_dataset and id=p_row for update;
  if not found or r.version<>p_version then raise exception 'Owned record changed'using errcode='40001';end if;
  if r.state in('source_missing','deleted')or r.conflicts<>'{}'::jsonb then raise exception 'Source record is missing; review it first'using errcode='40001';end if;
  if p_type='delete'and not coalesce((d.config->>'allow_delete')::boolean,false)then raise exception 'Deletion is not authorized for this table'using errcode='42501';end if;
 end if;
 for f in select jsonb_object_keys(p_values)loop
  select value into c from jsonb_array_elements(d.config->'columns')where value->>'key'=f;
  if not found then raise exception 'Unmapped field'using errcode='42501';end if;
  if p_type='update'and(not coalesce((c->>'writable')::boolean,false)or coalesce((c->>'key_part')::boolean,false)or not coalesce((r.remote_cells->f->>'writable')::boolean,false))then raise exception 'This field is read only'using errcode='42501';end if;
 end loop;
 update public.sheet_rest_operations set status='superseded'where user_id=p_user and row_id=p_row and status in('draft','approved','failed','conflict');
 if p_type<>'insert'then update public.sheet_rest_rows set local_values=local_values||p_values,state='pending'where id=p_row;end if;
 insert into public.sheet_rest_operations(id,user_id,dataset_id,row_id,operation_type,intended,expected_cells,status,approved_at)values(p_request,p_user,p_dataset,p_row,p_type,p_values,r.baseline,case when d.automatic_outbound and d.outbound_enabled then 'approved'else 'draft'end,case when d.automatic_outbound and d.outbound_enabled then now()end);
 insert into public.audit_logs(user_id,entity_type,entity_id,action,old_values,new_values)values(p_user,'sheet_rest_rows',p_row,'draft_'||p_type,r.local_values,p_values);
 return p_request;
end$$;
create function public.approve_sheet_rest(p_user uuid,p_dataset uuid,p_operation uuid,p_version integer)returns void language plpgsql security invoker set search_path=''as $$
declare d public.sheet_rest_datasets;o public.sheet_rest_operations;begin
 if not exists(select 1 from private.approved_users where user_id=p_user)then raise exception 'Unapproved owner'using errcode='42501';end if;
 select * into d from public.sheet_rest_datasets where user_id=p_user and id=p_dataset for update;
 if not found or not d.outbound_enabled or(not d.test_only and d.production_approved_at is null)then raise exception 'Outbound writes are not activated for this dataset'using errcode='42501';end if;
 if d.lease_until>now()then raise exception 'Source synchronization is running'using errcode='55P03';end if;
 select * into o from public.sheet_rest_operations where user_id=p_user and dataset_id=p_dataset and id=p_operation for update;
 if not found or o.version<>p_version or o.status<>'draft'then raise exception 'Edit changed; review it again'using errcode='40001';end if;
 if exists(select 1 from public.sheet_rest_rows where user_id=p_user and id=o.row_id and conflicts<>'{}'::jsonb)then raise exception 'Resolve source conflicts first'using errcode='40001';end if;
 update public.sheet_rest_operations set status='approved',approved_at=now(),last_error=null where id=o.id;
 insert into public.audit_logs(user_id,entity_type,entity_id,action,new_values)values(p_user,'sheet_rest_operations',o.id,'approve',jsonb_build_object('type',o.operation_type,'fields',o.intended));
end$$;
create function public.finish_sheet_rest(p_user uuid,p_dataset uuid,p_operation uuid,p_lease uuid,p_accepted boolean,p_deleted boolean default false)returns void language plpgsql security invoker set search_path=''as $$
declare d public.sheet_rest_datasets;o public.sheet_rest_operations;begin
 select * into d from public.sheet_rest_datasets where user_id=p_user and id=p_dataset for update;
 if not found or d.lease_token is distinct from p_lease or d.lease_until<now()then raise exception 'Source lease expired'using errcode='40001';end if;
 select * into o from public.sheet_rest_operations where user_id=p_user and dataset_id=p_dataset and id=p_operation for update;
 if not found or o.approved_at is null or o.status not in('approved','writing','unknown')or p_deleted<>(o.operation_type='delete')then raise exception 'Operation changed'using errcode='40001';end if;
 update public.sheet_rest_operations set status='confirmed',verified_at=now(),provider_accepted=p_accepted,last_error=null where id=o.id;
 if p_deleted then update public.sheet_rest_rows set state='deleted',remote_missing=true,conflicts='{}'where user_id=p_user and id=o.row_id;end if;
 update public.sheet_rest_datasets set last_write_at=now()where id=d.id;
 insert into public.audit_logs(user_id,entity_type,entity_id,action,new_values)values(p_user,'sheet_rest_operations',o.id,case when p_accepted then 'provider_write_verified'else 'source_convergence_verified'end,jsonb_build_object('fields',o.intended,'type',o.operation_type));
end$$;
do $$declare fn record;begin for fn in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in('claim_sheet_rest','ingest_sheet_rest','edit_sheet_rest','approve_sheet_rest','finish_sheet_rest')loop
 execute format('revoke all on function %s from public,anon,authenticated',fn.signature);execute format('grant execute on function %s to service_role',fn.signature);
end loop;end$$;
-- Conflict resolution is atomic with the reviewed row version. It never writes Google directly.
create function public.resolve_sheet_rest(p_user uuid,p_dataset uuid,p_row uuid,p_version integer,p_field text,p_keep text)returns void language plpgsql security invoker set search_path=''as $$
declare d public.sheet_rest_datasets;r public.sheet_rest_rows;c jsonb;v jsonb;begin
 if not exists(select 1 from private.approved_users where user_id=p_user)then raise exception 'Unapproved owner'using errcode='42501';end if;
 select * into d from public.sheet_rest_datasets where user_id=p_user and id=p_dataset for update;
 if not found or d.lease_until>now()then raise exception 'Source unavailable or synchronizing'using errcode='40001';end if;
 select * into r from public.sheet_rest_rows where user_id=p_user and dataset_id=p_dataset and id=p_row for update;
 if not found or r.version<>p_version or not(r.conflicts?p_field)or p_keep not in('local','remote')then raise exception 'Conflict changed; review again'using errcode='40001';end if;
 if p_keep='local'and not coalesce((r.remote_cells->p_field->>'writable')::boolean,false)then raise exception 'Source owns this field'using errcode='42501';end if;
 c=r.remote_cells->p_field;v=case when p_keep='local'then r.local_values->p_field else c->'value'end;
 update public.sheet_rest_rows set local_values=jsonb_set(local_values,array[p_field],v),baseline=jsonb_set(baseline,array[p_field],c),conflicts=conflicts-p_field,state=case when conflicts-p_field<>'{}'::jsonb then 'conflict'when p_keep='local'then 'pending'else 'synced'end where id=p_row;
 -- Existing approval described an older external state. Owner must review a fresh draft.
 update public.sheet_rest_operations set status='superseded'where user_id=p_user and row_id=p_row and status in('draft','approved','conflict','failed');
 insert into public.audit_logs(user_id,entity_type,entity_id,action,old_values,new_values)values(p_user,'sheet_rest_rows',p_row,'resolve_conflict',r.conflicts,jsonb_build_object('field',p_field,'keep',p_keep));
end$$;
revoke all on function public.resolve_sheet_rest(uuid,uuid,uuid,integer,text,text)from public,anon,authenticated;
grant execute on function public.resolve_sheet_rest(uuid,uuid,uuid,integer,text,text)to service_role;
-- Explicit project bindings connect the table ledger to existing Life OS entities.
create table public.sheet_rest_project_links(
 user_id uuid not null, row_id uuid primary key, dataset_id uuid not null,project_id uuid not null,field_key text not null,values_map jsonb not null,
 unique(user_id,project_id),foreign key(user_id,dataset_id,row_id)references public.sheet_rest_rows(user_id,dataset_id,id)on delete cascade,
 foreign key(user_id,project_id)references public.projects(user_id,id)on delete cascade,
 check(jsonb_typeof(values_map)='object')
);
alter table public.sheet_rest_project_links enable row level security;
revoke all on public.sheet_rest_project_links from public,anon,authenticated;
grant select on public.sheet_rest_project_links to authenticated;
grant all on public.sheet_rest_project_links to service_role;
create policy owner_read on public.sheet_rest_project_links for select to authenticated using(user_id=(select auth.uid())and public.is_approved_user());
create function private.project_sheet_rest_outbox()returns trigger language plpgsql security definer set search_path=''as $$
declare l public.sheet_rest_project_links;r public.sheet_rest_rows;v jsonb;pending jsonb;begin
 if old.status is not distinct from new.status then return new;end if;
 select * into l from public.sheet_rest_project_links where user_id=new.user_id and project_id=new.id;
 if not found then return new;end if;
 if (select auth.uid()) is not null and((select auth.uid())<>new.user_id or not public.is_approved_user())then raise exception 'Unapproved owner'using errcode='42501';end if;
 v=l.values_map->new.status;
 if v is null then raise exception 'Linked spreadsheet status has no configured value'using errcode='22023';end if;
 select * into r from public.sheet_rest_rows where user_id=new.user_id and id=l.row_id;
 if r.local_values->l.field_key is not distinct from v then return new;end if;
 select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb)into pending from jsonb_each(r.local_values)e where coalesce((r.remote_cells->e.key->>'writable')::boolean,false)and e.value is distinct from r.baseline->e.key->'value';
 perform public.edit_sheet_rest(new.user_id,l.dataset_id,r.id,r.version,gen_random_uuid(),'update',pending||jsonb_build_object(l.field_key,v),null,null);
 return new;
end$$;
create trigger project_sheet_rest_outbox after update of status on public.projects for each row execute function private.project_sheet_rest_outbox();
-- Called after ingestion in the same transaction, preventing partial project/ledger progress.
create function public.apply_sheet_rest_projects()returns trigger language plpgsql security invoker set search_path=''as $$
declare l public.sheet_rest_project_links;s text;begin
 for l in select * from public.sheet_rest_project_links where user_id=new.user_id and dataset_id=new.id loop
  select e.key into s from public.sheet_rest_rows r cross join lateral jsonb_each_text(l.values_map)e where r.id=l.row_id and not r.remote_missing and not(r.conflicts?l.field_key)and r.local_values->>l.field_key=e.value;
  if found then update public.projects set status=s where user_id=l.user_id and id=l.project_id and status is distinct from s;end if;
 end loop;return new;
end$$;
create trigger apply_sheet_rest_projects after update of last_read_at on public.sheet_rest_datasets for each row execute function public.apply_sheet_rest_projects();
revoke all on function private.project_sheet_rest_outbox(),public.apply_sheet_rest_projects()from public,anon,authenticated;
grant execute on function private.project_sheet_rest_outbox(),public.apply_sheet_rest_projects()to service_role;
create function public.bind_sheet_rest_project(p_user uuid,p_dataset uuid,p_row uuid,p_version integer,p_project uuid,p_project_version integer,p_field text,p_map jsonb)returns void language plpgsql security invoker set search_path=''as $$
declare r public.sheet_rest_rows;p public.projects;c jsonb;begin
 if not exists(select 1 from private.approved_users where user_id=p_user)then raise exception 'Unapproved owner'using errcode='42501';end if;
 perform 1 from public.sheet_rest_datasets where user_id=p_user and id=p_dataset and(lease_until is null or lease_until<now())for update;
 if not found then raise exception 'Source unavailable or syncing'using errcode='40001';end if;
 select * into r from public.sheet_rest_rows where user_id=p_user and dataset_id=p_dataset and id=p_row for update;
 select * into p from public.projects where user_id=p_user and id=p_project for update;
 if r.id is null or p.id is null or r.version<>p_version or p.version<>p_project_version then raise exception 'Owned records changed'using errcode='40001';end if;
 if not coalesce((r.remote_cells->p_field->>'writable')::boolean,false)or r.conflicts<>'{}'::jsonb or r.local_values->>p_field is distinct from p_map->>p.status then raise exception 'Align the literal spreadsheet value and project status before binding'using errcode='22023';end if;
 if (select count(*) from jsonb_object_keys(p_map))<>4 or not(p_map?'active'and p_map?'paused'and p_map?'completed'and p_map?'cancelled')then raise exception 'Invalid status map'using errcode='22023';end if;
 if exists(select 1 from public.sheet_sync_mappings where user_id=p_user and project_id=p_project)then raise exception 'Pause and retire the legacy project mapping before binding this project'using errcode='40001';end if;
 insert into public.sheet_rest_project_links(user_id,row_id,dataset_id,project_id,field_key,values_map)values(p_user,p_row,p_dataset,p_project,p_field,p_map);
 insert into public.audit_logs(user_id,entity_type,entity_id,action,new_values)values(p_user,'sheet_rest_rows',p_row,'link_project',jsonb_build_object('project_id',p_project,'field',p_field));
end$$;
revoke all on function public.bind_sheet_rest_project(uuid,uuid,uuid,integer,uuid,integer,text,jsonb)from public,anon,authenticated;
grant execute on function public.bind_sheet_rest_project(uuid,uuid,uuid,integer,uuid,integer,text,jsonb)to service_role;
create index sheet_rest_dataset_connection on public.sheet_rest_datasets(user_id,connection_id);
create index sheet_rest_dataset_source on public.sheet_rest_datasets(user_id,source_id);
create index sheet_rest_operation_row on public.sheet_rest_operations(user_id,dataset_id,row_id);
create index sheet_rest_test_connection on public.sheet_rest_tests(user_id,connection_id);
create index sheet_rest_test_dataset on public.sheet_rest_tests(user_id,dataset_id);
create index sheet_rest_link_dataset on public.sheet_rest_project_links(user_id,dataset_id,row_id);
