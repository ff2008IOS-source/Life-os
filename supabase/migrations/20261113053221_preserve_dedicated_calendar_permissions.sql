-- Refreshing a calendar list or read selection must preserve separately authorized app-calendar writes.
-- This does not grant writes to newly discovered or personal calendars. Role loss revokes writes.
create or replace function public.google_store_calendars(p_user uuid,p_connection uuid,p_calendars jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.calendar_connections where user_id=p_user and id=p_connection and status='connected' for update;
 if not found or not exists(select 1 from private.approved_users where user_id=p_user) then raise exception 'Invalid connection'; end if;
 insert into public.calendars(user_id,connection_id,provider_calendar_id,name,timezone,color,access_role)
 select p_user,p_connection,x.id,x.name,x.timezone,x.color,x.access_role from jsonb_to_recordset(p_calendars) as x(id text,name text,timezone text,color text,access_role text)
 on conflict(user_id,connection_id,provider_calendar_id) do update set name=excluded.name,timezone=excluded.timezone,color=excluded.color,access_role=excluded.access_role,write_enabled=calendars.is_life_os_owned and calendars.write_enabled and excluded.access_role='owner',is_life_os_owned=calendars.is_life_os_owned and excluded.access_role='owner';
 -- Retain cached history but stop syncing calendars that are no longer accessible.
 update public.calendars set sync_enabled=false,sync_error='Calendar is no longer accessible. Reconnect or review sharing.'
 where user_id=p_user and connection_id=p_connection and not exists(select 1 from jsonb_array_elements(p_calendars) x where x->>'id'=provider_calendar_id);
end $$;

create or replace function public.google_select_calendar(p_user uuid,p_calendar uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 update public.calendars set sync_enabled=p_enabled,write_enabled=write_enabled and is_life_os_owned and access_role='owner',is_life_os_owned=is_life_os_owned and access_role='owner' where user_id=p_user and id=p_calendar and exists(select 1 from private.approved_users where user_id=p_user);
 if not found then raise exception 'Invalid calendar'; end if;
end $$;

