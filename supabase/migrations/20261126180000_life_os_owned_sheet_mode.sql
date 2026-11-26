-- Life OS becomes the source of truth for selected tables from owner_since onward. Additive.
-- Rows that already held content when ownership began are frozen history: never edited, never overwritten.
alter table public.sheet_rest_datasets drop constraint if exists sheet_rest_datasets_mode_check;
alter table public.sheet_rest_datasets add constraint sheet_rest_datasets_mode_check
 check(mode in('import_only','export_only','two_way','life_os_owned','paused'));
alter table public.sheet_rest_datasets add column if not exists owner_since timestamptz;
alter table public.sheet_rest_datasets add constraint sheet_rest_owned_needs_date
 check(mode<>'life_os_owned' or owner_since is not null);
alter table public.sheet_rest_rows add column if not exists frozen boolean not null default false;

-- Atomic activation: freeze rows that already hold content, then switch mode. Writes nothing to Google.
create function public.activate_life_os_owned(p_user uuid,p_dataset uuid,p_version integer,p_allow_insert boolean,p_automatic boolean)returns integer language plpgsql security invoker set search_path=''as $$
declare d public.sheet_rest_datasets;n integer;begin
 if not exists(select 1 from private.approved_users where user_id=p_user)then raise exception 'Unapproved owner'using errcode='42501';end if;
 select * into d from public.sheet_rest_datasets where user_id=p_user and id=p_dataset for update;
 if not found or d.version<>p_version or d.test_only then raise exception 'Table changed or is a test table'using errcode='40001';end if;
 if d.lease_until>now()then raise exception 'Source synchronization is running'using errcode='55P03';end if;
 if not d.outbound_enabled or d.production_approved_at is null then raise exception 'Outbound writes are not activated for this dataset'using errcode='42501';end if;
 update public.sheet_rest_rows r set frozen=true where r.user_id=p_user and r.dataset_id=p_dataset and exists(
  select 1 from jsonb_each(r.local_values)e where e.value<>'null'::jsonb and e.value<>'""'::jsonb and e.key in(select c->>'key' from jsonb_array_elements(d.config->'columns')c where coalesce((c->>'writable')::boolean,false)));
 get diagnostics n=row_count;
 update public.sheet_rest_datasets set mode='life_os_owned',owner_since=now(),automatic_outbound=p_automatic,
  config=jsonb_set(config,'{allow_insert}',to_jsonb(p_allow_insert))where id=p_dataset;
 insert into public.audit_logs(user_id,entity_type,entity_id,action,new_values)values(p_user,'sheet_rest_datasets',p_dataset,'activate_life_os_owned',jsonb_build_object('frozen_rows',n,'allow_insert',p_allow_insert,'automatic',p_automatic));
 return n;
end$$;
revoke all on function public.activate_life_os_owned(uuid,uuid,integer,boolean,boolean)from public,anon,authenticated;
grant execute on function public.activate_life_os_owned(uuid,uuid,integer,boolean,boolean)to service_role;

-- Database-level guard: no outbound operation may ever target a frozen row of an owned table.
create function private.guard_frozen_sheet_rows()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if exists(select 1 from public.sheet_rest_rows r join public.sheet_rest_datasets d on d.id=r.dataset_id where r.id=new.row_id and d.mode='life_os_owned' and r.frozen)then
  raise exception 'This record predates Life OS ownership and is read-only history'using errcode='42501';
 end if;
 return new;
end$$;
create trigger guard_frozen before insert on public.sheet_rest_operations for each row execute function private.guard_frozen_sheet_rows();
