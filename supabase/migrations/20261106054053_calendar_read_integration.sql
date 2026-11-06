-- Stage B: read-only provider import. No Google writes or scheduling activation.
alter table public.calendars add column last_synced_at timestamptz,
 add column coverage_start timestamptz, add column coverage_end timestamptz,
 add column sync_error text, add column sync_lease uuid, add column sync_lease_until timestamptz;

-- Only trusted server RPCs may access encrypted credentials. Session/RLS clients
-- retain SELECT-only access to provider-owned public records.
create function public.google_save_connection(p_user uuid,p_account text,p_envelope text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_connection uuid; v_credential uuid;
begin
 if not exists(select 1 from private.approved_users where user_id=p_user) then raise exception 'Unapproved user'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||':'||p_account,0));
 select id,credential_ref into v_connection,v_credential from public.calendar_connections where user_id=p_user and provider='google' and provider_account_id=p_account for update;
 if v_credential is null then
  insert into private.oauth_credentials(user_id,provider,encrypted_payload,key_version) values(p_user,'google',convert_to(p_envelope,'UTF8'),1) returning id into v_credential;
 else
  update private.oauth_credentials set encrypted_payload=convert_to(p_envelope,'UTF8'),updated_at=now() where user_id=p_user and id=v_credential;
 end if;
 insert into public.calendar_connections(user_id,provider,provider_account_id,credential_ref,status)
 values(p_user,'google',p_account,v_credential,'connected') on conflict(user_id,provider,provider_account_id)
 do update set credential_ref=excluded.credential_ref,status='connected' returning id into v_connection;
 return v_connection;
end $$;

create function public.google_get_credential(p_user uuid,p_connection uuid)
returns text language sql stable security definer set search_path='' as $$
 select convert_from(s.encrypted_payload,'UTF8') from private.oauth_credentials s
 join public.calendar_connections c on c.user_id=s.user_id and c.credential_ref=s.id
 where c.user_id=p_user and c.id=p_connection and c.status='connected'
 and exists(select 1 from private.approved_users where user_id=p_user)
$$;

create function public.google_store_calendars(p_user uuid,p_connection uuid,p_calendars jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.calendar_connections where user_id=p_user and id=p_connection and status='connected' for update;
 if not found or not exists(select 1 from private.approved_users where user_id=p_user) then raise exception 'Invalid connection'; end if;
 insert into public.calendars(user_id,connection_id,provider_calendar_id,name,timezone,color,access_role)
 select p_user,p_connection,x.id,x.name,x.timezone,x.color,x.access_role from jsonb_to_recordset(p_calendars) as x(id text,name text,timezone text,color text,access_role text)
 on conflict(user_id,connection_id,provider_calendar_id) do update set name=excluded.name,timezone=excluded.timezone,color=excluded.color,access_role=excluded.access_role,write_enabled=false,is_life_os_owned=false;
 -- Retain cached history but stop syncing calendars that are no longer accessible.
 update public.calendars set sync_enabled=false,sync_error='Calendar is no longer accessible. Reconnect or review sharing.'
 where user_id=p_user and connection_id=p_connection and not exists(select 1 from jsonb_array_elements(p_calendars) x where x->>'id'=provider_calendar_id);
end $$;

create function public.google_select_calendar(p_user uuid,p_calendar uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 update public.calendars set sync_enabled=p_enabled,write_enabled=false,is_life_os_owned=false where user_id=p_user and id=p_calendar and exists(select 1 from private.approved_users where user_id=p_user);
 if not found then raise exception 'Invalid calendar'; end if;
end $$;

create function public.google_claim_sync(p_user uuid,p_calendar uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare lease uuid:=gen_random_uuid();
begin
 update public.calendars set sync_lease=lease,sync_lease_until=now()+interval '90 seconds',sync_error=null
 where user_id=p_user and id=p_calendar and sync_enabled and (sync_lease_until is null or sync_lease_until<now())
 and exists(select 1 from private.approved_users where user_id=p_user)
 and exists(select 1 from public.calendar_connections c where c.user_id=p_user and c.id=connection_id and c.status='connected');
 if not found then raise exception 'Calendar is disabled or synchronization is already running'; end if;
 return lease;
end $$;

create function public.google_finish_sync(p_user uuid,p_calendar uuid,p_lease uuid,p_start timestamptz,p_end timestamptz,p_events jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 perform 1 from public.calendars where user_id=p_user and id=p_calendar and sync_enabled and sync_lease=p_lease and sync_lease_until>now() for update;
 if not found then raise exception 'Synchronization lease expired or calendar selection changed'; end if;
 if p_end<=p_start or jsonb_array_length(p_events)>10000 then raise exception 'Invalid synchronization window'; end if;
 -- A complete, paginated provider snapshot replaces this calendar's cached window
 -- atomically. Missing/deleted instances are cancelled, never duplicated.
 update public.calendar_events set event_status='cancelled' where user_id=p_user and calendar_id=p_calendar and event_status<>'cancelled'
 and ((start_at<p_end and end_at>p_start) or (all_day_start<(p_end at time zone 'America/Vancouver')::date and all_day_end>(p_start at time zone 'America/Vancouver')::date));
 insert into public.calendar_events(user_id,calendar_id,provider_event_id,provider_ical_uid,title,start_at,end_at,all_day_start,all_day_end,timezone,busy_status,event_status,etag,provider_updated_at,protection_level,raw_metadata)
 select p_user,p_calendar,x.provider_event_id,x.provider_ical_uid,x.title,x.start_at,x.end_at,x.all_day_start,x.all_day_end,x.timezone,x.busy_status,x.event_status,x.etag,x.provider_updated_at,'protected',x.raw_metadata
 from jsonb_to_recordset(p_events) as x(provider_event_id text,provider_ical_uid text,title text,start_at timestamptz,end_at timestamptz,all_day_start date,all_day_end date,timezone text,busy_status text,event_status text,etag text,provider_updated_at timestamptz,raw_metadata jsonb)
 on conflict(user_id,calendar_id,provider_event_id) do update set provider_ical_uid=excluded.provider_ical_uid,title=excluded.title,start_at=excluded.start_at,end_at=excluded.end_at,all_day_start=excluded.all_day_start,all_day_end=excluded.all_day_end,timezone=excluded.timezone,busy_status=excluded.busy_status,event_status=excluded.event_status,etag=excluded.etag,provider_updated_at=excluded.provider_updated_at,protection_level='protected',raw_metadata=excluded.raw_metadata;
 get diagnostics n=row_count;
 update public.calendars set last_synced_at=now(),coverage_start=p_start,coverage_end=p_end,sync_lease=null,sync_lease_until=null,sync_error=null where user_id=p_user and id=p_calendar;
 update public.calendar_connections set last_sync_at=now() where user_id=p_user and id=(select connection_id from public.calendars where user_id=p_user and id=p_calendar);
 return n;
end $$;

create function public.google_fail_sync(p_user uuid,p_calendar uuid,p_lease uuid,p_error text)
returns void language sql security definer set search_path='' as $$
 update public.calendars set sync_lease=null,sync_lease_until=null,sync_error=left(p_error,300)
 where user_id=p_user and id=p_calendar and sync_lease=p_lease
$$;

create function public.google_disconnect(p_user uuid,p_connection uuid)
returns void language plpgsql security definer set search_path='' as $$
declare credential uuid;
begin
 select credential_ref into credential from public.calendar_connections where user_id=p_user and id=p_connection for update;
 update public.calendars set sync_enabled=false,sync_lease=null,sync_lease_until=null where user_id=p_user and connection_id=p_connection;
 update public.calendar_connections set status='revoked',credential_ref=null where user_id=p_user and id=p_connection;
 delete from private.oauth_credentials where user_id=p_user and id=credential;
end $$;

revoke all on function public.google_save_connection(uuid,text,text),public.google_get_credential(uuid,uuid),public.google_store_calendars(uuid,uuid,jsonb),public.google_select_calendar(uuid,uuid,boolean),public.google_claim_sync(uuid,uuid),public.google_finish_sync(uuid,uuid,uuid,timestamptz,timestamptz,jsonb),public.google_fail_sync(uuid,uuid,uuid,text),public.google_disconnect(uuid,uuid) from public,anon,authenticated;
grant execute on function public.google_save_connection(uuid,text,text),public.google_get_credential(uuid,uuid),public.google_store_calendars(uuid,uuid,jsonb),public.google_select_calendar(uuid,uuid,boolean),public.google_claim_sync(uuid,uuid),public.google_finish_sync(uuid,uuid,uuid,timestamptz,timestamptz,jsonb),public.google_fail_sync(uuid,uuid,uuid,text),public.google_disconnect(uuid,uuid) to service_role;
create index calendar_events_all_day on public.calendar_events(user_id,calendar_id,all_day_start,all_day_end);
