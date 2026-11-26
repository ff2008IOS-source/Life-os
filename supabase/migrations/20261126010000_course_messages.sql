-- Course updates: Canvas announcements and forwarded course emails, with
-- flags for anything that may change grading, dates, or a posted mark.
create table public.course_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid,
  source text not null check (source in ('canvas_announcement','email')),
  external_id text not null,
  title text not null check (length(title) <= 500),
  body text not null default '' check (length(body) <= 8000),
  sender text check (length(sender) <= 300),
  url text check (length(url) <= 1000),
  posted_at timestamptz not null,
  flags text[] not null default '{}',
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, source, external_id),
  foreign key (user_id, course_id) references public.courses(user_id, id) on delete set null (course_id)
);
create index course_messages_recent on public.course_messages(user_id, posted_at desc);
alter table public.course_messages enable row level security;
revoke all on public.course_messages from public, anon, authenticated;
grant select, update on public.course_messages to authenticated;
grant all on public.course_messages to service_role;
create policy own_read on public.course_messages for select to authenticated
  using (user_id = auth.uid() and public.is_approved_user());
create policy own_ack on public.course_messages for update to authenticated
  using (user_id = auth.uid() and public.is_approved_user())
  with check (user_id = auth.uid() and public.is_approved_user());

-- One private token per owner lets their Gmail script post course emails.
-- Only a SHA-256 hash is stored.
create table public.email_intake_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.email_intake_tokens enable row level security;
revoke all on public.email_intake_tokens from public, anon, authenticated;
grant select on public.email_intake_tokens to authenticated;
grant all on public.email_intake_tokens to service_role;
create policy own_read on public.email_intake_tokens for select to authenticated
  using (user_id = auth.uid() and public.is_approved_user());

-- Rollback:
--   drop table if exists public.email_intake_tokens;
--   drop table if exists public.course_messages;
