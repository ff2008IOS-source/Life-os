-- Synthetic Auth schema for local PostgreSQL tests only; not used by application code.
create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key);
create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade);
create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,status text not null,factor_type text not null);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('sub',auth.uid(),'aal',coalesce(nullif(current_setting('request.jwt.claim.aal',true),''),'aal1'),'session_id',coalesce(nullif(current_setting('request.jwt.claim.session_id',true),''),auth.uid()::text))$$;
create function auth.seed_test_session() returns trigger language plpgsql as $$begin insert into auth.sessions(id,user_id) values(new.id,new.id);return new;end$$;
create trigger test_session after insert on auth.users for each row execute function auth.seed_test_session();
grant usage on schema auth to authenticated;
grant execute on function auth.uid(),auth.jwt() to authenticated;
