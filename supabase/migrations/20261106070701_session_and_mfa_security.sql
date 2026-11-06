-- Approved identity plus a live Auth session, without requiring the second factor.
-- This narrow boolean is used only to gate login/MFA workflows before elevation.
create function public.has_registered_session()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.approved_users a where a.user_id=auth.uid())
 and exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id')
$$;
revoke all on function public.has_registered_session() from public,anon;
grant execute on function public.has_registered_session() to authenticated;
-- A revoked session loses database access before its JWT expires. Every existing
-- private-table policy uses this function, so a verified MFA factor requires AAL2.
create or replace function public.is_approved_user()
returns boolean language sql stable security definer set search_path='' as $$
 select public.has_registered_session()
 and (auth.jwt()->>'aal'='aal2' or not exists(select 1 from auth.mfa_factors f where f.user_id=auth.uid() and f.status='verified'))
$$;
revoke all on function public.is_approved_user() from public,anon;
grant execute on function public.is_approved_user() to authenticated;
