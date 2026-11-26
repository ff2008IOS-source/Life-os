-- Direct SFU Outlook connection (Microsoft Graph, read-only mail).
-- The refresh token is encrypted with the server key; only the server
-- role can read it. The owner sees status through the API.
create table public.outlook_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  client_id text not null check (client_id ~ '^[0-9a-fA-F-]{36}$'),
  tenant text not null default 'organizations' check (length(tenant) <= 100),
  token_ciphertext text,
  token_iv text,
  account text check (length(account) <= 300),
  excluded_folders text[] not null default '{}',
  backfill_next text check (length(backfill_next) <= 4000),
  backfill_done boolean not null default false,
  newest_received timestamptz,
  imported integer not null default 0,
  last_sync_at timestamptz,
  last_error text check (length(last_error) <= 300),
  created_at timestamptz not null default now()
);
alter table public.outlook_connections enable row level security;
revoke all on public.outlook_connections from public, anon, authenticated;
grant all on public.outlook_connections to service_role;

-- Rollback:
--   drop table if exists public.outlook_connections;
