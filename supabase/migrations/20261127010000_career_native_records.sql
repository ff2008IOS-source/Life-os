-- Life OS becomes the place career records are kept (the Google Sheets
-- career dashboard can be archived). Additive only.

-- Career records: actual applications are distinct from target employers;
-- co-op terms and reference guidance join the existing kinds.
alter table public.career_entries drop constraint career_entries_kind_check;
alter table public.career_entries add constraint career_entries_kind_check
  check (kind = any (array[
    'contact', 'skill', 'application_target', 'application', 'roadmap',
    'coop_term', 'career_goal', 'portfolio_project', 'review', 'reference'
  ]));
alter table public.career_entries
  add column due_date date,
  add column archived_at timestamptz,
  -- Import bookkeeping: what the workbook last said (hash of the imported
  -- fields) so a re-run can tell an untouched import from a Life OS edit.
  add column import_hash text,
  add column imported_at timestamptz,
  add column sort_order integer;
create unique index career_entries_owner_source_key
  on public.career_entries (user_id, source_key)
  where source_key is not null and source_id is null;
create index career_entries_owner_kind on public.career_entries (user_id, kind)
  where archived_at is null;

alter table public.contacts
  add column how_met text check (length(how_met) <= 1000),
  add column archived_at timestamptz,
  add column import_hash text,
  add column imported_at timestamptz;
create unique index contacts_owner_source_key
  on public.contacts (user_id, source_key)
  where source_key is not null and source_id is null;

-- A log of conversations with a contact; the latest sets last contact.
create table public.contact_interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null,
  occurred_on date not null,
  summary text not null check (length(trim(summary)) between 1 and 4000),
  next_follow_up_date date,
  source_key text check (length(source_key) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  foreign key (user_id, contact_id) references public.contacts (user_id, id) on delete cascade
);
create index contact_interactions_owner on public.contact_interactions (user_id, contact_id, occurred_on desc);
create unique index contact_interactions_owner_source_key
  on public.contact_interactions (user_id, source_key) where source_key is not null;
alter table public.contact_interactions enable row level security;
revoke all on public.contact_interactions from public, anon, authenticated;
grant select, insert, update, delete on public.contact_interactions to authenticated;
grant all on public.contact_interactions to service_role;
create policy own_records on public.contact_interactions for all to authenticated
  using (user_id = auth.uid() and public.is_approved_user())
  with check (user_id = auth.uid() and public.is_approved_user());
create trigger contact_interactions_stamp before update on public.contact_interactions
  for each row execute function public.stamp_record();

-- Weekly reviews keep the workbook's extra columns (picks, progress notes)
-- and the same import bookkeeping.
alter table public.reviews
  add column details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 32768),
  add column source_key text check (length(source_key) <= 300),
  add column import_hash text,
  add column imported_at timestamptz;

-- Rollback:
--   drop table if exists public.contact_interactions;
--   alter table public.reviews drop column details, drop column source_key,
--     drop column import_hash, drop column imported_at;
--   alter table public.contacts drop column how_met, drop column archived_at,
--     drop column import_hash, drop column imported_at;
--   drop index if exists career_entries_owner_source_key, career_entries_owner_kind,
--     contacts_owner_source_key;
--   alter table public.career_entries drop column due_date, drop column archived_at,
--     drop column import_hash, drop column imported_at, drop column sort_order;
--   (restore the previous kind check only after removing rows of the new kinds)
