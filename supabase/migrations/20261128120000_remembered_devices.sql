-- Two-step sign-in with "remember this device for 14 days".
-- After a verified authenticator code, the browser gets a random device
-- token (httpOnly cookie). Only its SHA-256 hash is stored here. A later
-- password sign-in on that device presents the token, and the new session
-- is trusted until the device's 14 days end. Nothing extends the 14 days.
create table if not exists private.trusted_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists trusted_devices_owner on private.trusted_devices(user_id);
create table if not exists private.trusted_sessions (
  session_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references private.trusted_devices(id) on delete cascade
);
revoke all on private.trusted_devices, private.trusted_sessions from public, anon, authenticated;

-- Is the current session trusted through a remembered device that hasn't expired?
create or replace function public.session_trusted()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
   select 1 from private.trusted_sessions s
   join private.trusted_devices d on d.id = s.device_id
   where s.session_id = auth.jwt()->>'session_id'
     and s.user_id = auth.uid() and d.user_id = auth.uid()
     and d.expires_at > now())
$$;
revoke all on function public.session_trusted() from public, anon;
grant execute on function public.session_trusted() to authenticated;

-- Every private-table policy uses this: a verified factor requires AAL2,
-- or a session trusted through a remembered device.
create or replace function public.is_approved_user()
returns boolean language sql stable security definer set search_path='' as $$
 select public.has_registered_session()
 and (auth.jwt()->>'aal'='aal2'
   or not exists(select 1 from auth.mfa_factors f where f.user_id=auth.uid() and f.status='verified')
   or public.session_trusted())
$$;
revoke all on function public.is_approved_user() from public, anon;
grant execute on function public.is_approved_user() to authenticated;

-- Remember this device: only from a session that just passed the code (AAL2).
create or replace function public.remember_this_device(p_hash text)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_until timestamptz := now() + interval '14 days';
begin
 if not public.has_registered_session() or auth.jwt()->>'aal' is distinct from 'aal2' then
   raise exception 'two-step verification required' using errcode = '42501';
 end if;
 delete from private.trusted_devices where user_id = auth.uid() and expires_at <= now();
 insert into private.trusted_devices(user_id, token_hash, expires_at)
   values (auth.uid(), p_hash, v_until) returning id into v_id;
 insert into private.trusted_sessions(session_id, user_id, device_id)
   values (auth.jwt()->>'session_id', auth.uid(), v_id)
   on conflict (session_id) do update set device_id = excluded.device_id;
 return v_until;
end $$;
revoke all on function public.remember_this_device(text) from public, anon;
grant execute on function public.remember_this_device(text) to authenticated;

-- A password sign-in on a remembered device: trust this new session.
create or replace function public.trust_this_session(p_hash text)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare v_device private.trusted_devices;
begin
 if not public.has_registered_session() then return null; end if;
 select * into v_device from private.trusted_devices
  where user_id = auth.uid() and token_hash = p_hash and expires_at > now();
 if not found then return null; end if;
 insert into private.trusted_sessions(session_id, user_id, device_id)
   values (auth.jwt()->>'session_id', auth.uid(), v_device.id)
   on conflict (session_id) do update set device_id = excluded.device_id;
 return v_device.expires_at;
end $$;
revoke all on function public.trust_this_session(text) from public, anon;
grant execute on function public.trust_this_session(text) to authenticated;

-- What Settings shows: how many devices are remembered, and until when
-- this one is (null when this session isn't through a remembered device).
create or replace function public.remembered_devices()
returns table(device_count integer, this_device_until timestamptz)
language sql stable security definer set search_path='' as $$
 select
  (select count(*)::int from private.trusted_devices d where d.user_id = auth.uid() and d.expires_at > now()),
  (select d.expires_at from private.trusted_sessions s join private.trusted_devices d on d.id = s.device_id
    where s.session_id = auth.jwt()->>'session_id' and s.user_id = auth.uid() and d.expires_at > now())
 where public.has_registered_session()
$$;
revoke all on function public.remembered_devices() from public, anon;
grant execute on function public.remembered_devices() to authenticated;

-- Forget every remembered device (also used when the authenticator is removed).
create or replace function public.forget_remembered_devices()
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if not public.has_registered_session() then
   raise exception 'sign in required' using errcode = '42501';
 end if;
 delete from private.trusted_devices where user_id = auth.uid();
 get diagnostics n = row_count;
 return n;
end $$;
revoke all on function public.forget_remembered_devices() from public, anon;
grant execute on function public.forget_remembered_devices() to authenticated;
