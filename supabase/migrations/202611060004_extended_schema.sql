-- Extended schema only. No connections, imports, workers, or automation activated.
-- Provider-owned state is SELECT-only for authenticated users. Trusted server writes
-- must later be implemented with narrowly authorized integration services.
create table private.oauth_credentials (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 provider text not null, encrypted_payload bytea not null,key_version integer not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(), unique(user_id,id)
);
revoke all on private.oauth_credentials from public,anon,authenticated;
alter table private.oauth_credentials enable row level security;
create table public.data_sources (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 provider text not null, source_key text not null, reference_url text, verification_status text not null default 'unverified' check(verification_status in ('unverified','user_confirmed','verified')), last_checked_at timestamptz, metadata jsonb not null default '{}',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),unique(user_id,provider,source_key)
);
create table public.import_batches (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 source_id uuid not null, status text not null default 'pending' check(status in ('pending','validated','completed','failed')), mapping_version integer, schema_fingerprint text, started_at timestamptz, finished_at timestamptz, imported_count integer not null default 0 check(imported_count>=0), error_summary text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),foreign key(user_id,source_id) references public.data_sources(user_id,id)
);
create table public.calendar_connections (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 provider text not null check(provider='google'), provider_account_id text not null, credential_ref uuid, status text not null default 'disconnected' check(status in ('disconnected','connected','error','revoked')), last_sync_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),unique(user_id,provider,provider_account_id),foreign key(user_id,credential_ref) references private.oauth_credentials(user_id,id)
);
create table public.calendars (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 connection_id uuid not null, provider_calendar_id text not null, name text not null, timezone text not null, color text, access_role text not null, sync_enabled boolean not null default false, write_enabled boolean not null default false, is_life_os_owned boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),foreign key(user_id,connection_id) references public.calendar_connections(user_id,id),unique(user_id,connection_id,provider_calendar_id),check(not write_enabled or is_life_os_owned)
);
create table public.calendar_events (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 calendar_id uuid not null, provider_event_id text not null, provider_ical_uid text, title text not null default '', start_at timestamptz, end_at timestamptz, all_day_start date, all_day_end date, timezone text not null, busy_status text not null check(busy_status in ('busy','free')), event_status text not null check(event_status in ('confirmed','tentative','cancelled')), etag text, provider_updated_at timestamptz, protection_level text not null default 'protected' check(protection_level in ('protected','life_os_work')), raw_metadata jsonb not null default '{}',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),foreign key(user_id,calendar_id) references public.calendars(user_id,id),unique(user_id,calendar_id,provider_event_id),check(event_status='cancelled' or ((start_at is not null and end_at>start_at and all_day_start is null and all_day_end is null) or (all_day_start is not null and all_day_end>all_day_start and start_at is null and end_at is null)))
);
create table public.scheduling_policies (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 name text not null, enabled boolean not null default false check(enabled=false), timezone text not null default 'America/Vancouver', work_windows jsonb not null default '{"start_hour":9,"end_hour":21,"days":[1,2,3,4,5,6,7]}', excluded_dates date[] not null default '{}', max_daily_minutes integer not null default 240 check(max_daily_minutes between 25 and 240), min_session_minutes integer not null default 25 check(min_session_minutes>=25), max_session_minutes integer not null default 90 check(max_session_minutes<=90), break_minutes integer not null default 10 check(break_minutes>=10), freeze_minutes integer not null default 60 check(freeze_minutes>=60), scheduling_horizon_days integer not null default 7 check(scheduling_horizon_days between 1 and 7), priority_rules jsonb not null default '{}',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),check(max_session_minutes>=min_session_minutes)
);
create table public.work_blocks (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 task_id uuid not null, occurrence_id uuid, calendar_event_id uuid, start_at timestamptz not null, end_at timestamptz not null, status text not null default 'proposed' check(status in ('proposed','planned','completed','cancelled','failed')), flexibility text not null default 'flexible' check(flexibility in ('flexible','fixed')), policy_version integer not null, last_planned_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),foreign key(user_id,task_id) references public.tasks(user_id,id),foreign key(user_id,occurrence_id) references public.task_occurrences(user_id,id),foreign key(user_id,calendar_event_id) references public.calendar_events(user_id,id),check(end_at>start_at),unique(user_id,calendar_event_id)
);
create table public.scheduling_runs (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 policy_id uuid, started_at timestamptz not null default now(), finished_at timestamptz, status text not null check(status in ('preview','applying','completed','failed','stale')), input_revision text not null, proposed_count integer not null default 0 check(proposed_count>=0), applied_count integer not null default 0 check(applied_count>=0), error_summary text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),foreign key(user_id,policy_id) references public.scheduling_policies(user_id,id)
);
create table public.scheduling_decisions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 run_id uuid not null, task_id uuid, work_block_id uuid, decision_type text not null, old_start_at timestamptz, new_start_at timestamptz, reason_code text not null, outcome text not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),foreign key(user_id,run_id) references public.scheduling_runs(user_id,id),foreign key(user_id,task_id) references public.tasks(user_id,id),foreign key(user_id,work_block_id) references public.work_blocks(user_id,id)
);
create table public.integration_jobs (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 connection_id uuid, job_type text not null, idempotency_key text not null, payload jsonb not null default '{}', status text not null default 'pending' check(status in ('pending','running','completed','failed','cancelled')), attempts integer not null default 0 check(attempts>=0), next_attempt_at timestamptz not null default now(), lease_until timestamptz, lease_token uuid, last_error text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),foreign key(user_id,connection_id) references public.calendar_connections(user_id,id),unique(user_id,idempotency_key)
);
create table public.sync_cursors (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 connection_id uuid not null, calendar_id uuid not null, cursor_value text not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),foreign key(user_id,connection_id) references public.calendar_connections(user_id,id),foreign key(user_id,calendar_id) references public.calendars(user_id,id),unique(user_id,calendar_id)
);
create table public.integration_conflicts (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 connection_id uuid not null, entity_type text not null, entity_id uuid not null, local_version text, remote_version text, conflict_type text not null, status text not null default 'open' check(status in ('open','resolved','dismissed')), resolved_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),foreign key(user_id,connection_id) references public.calendar_connections(user_id,id)
);
create table public.academic_terms (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 name text not null, start_date date not null, end_date date not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),check(end_date>=start_date),unique(user_id,name)
);
create table public.courses (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 term_id uuid not null, code text not null, title text not null, description text not null default '', grading_method text not null default 'unknown' check(grading_method in ('unknown','assessment_weights','category_weights','points')), source_id uuid, verification_status text not null default 'unverified' check(verification_status in ('unverified','user_confirmed','verified')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),foreign key(user_id,term_id) references public.academic_terms(user_id,id),foreign key(user_id,source_id) references public.data_sources(user_id,id),unique(user_id,term_id,code)
);
create table public.grading_categories (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 course_id uuid not null, name text not null, weight numeric(7,4) check(weight between 0 and 100), drop_lowest_count integer not null default 0 check(drop_lowest_count>=0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),foreign key(user_id,course_id) references public.courses(user_id,id),unique(user_id,course_id,name)
);
create table public.assessments (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 course_id uuid not null, category_id uuid, task_id uuid, title text not null, weight numeric(7,4) check(weight between 0 and 100), maximum_score numeric(12,4) check(maximum_score>0), earned_score numeric(12,4) check(earned_score>=0), submission_state text not null default 'unknown' check(submission_state in ('unknown','not_submitted','submitted','returned','excused')), due_at timestamptz, due_date date, verification_status text not null default 'unverified' check(verification_status in ('unverified','user_confirmed','verified')), source_id uuid, source_key text, dropped boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),foreign key(user_id,course_id) references public.courses(user_id,id),foreign key(user_id,category_id) references public.grading_categories(user_id,id),foreign key(user_id,task_id) references public.tasks(user_id,id),foreign key(user_id,source_id) references public.data_sources(user_id,id),check(due_at is null or due_date is null),check(earned_score is null or maximum_score is not null),unique(user_id,source_id,source_key)
);
create table public.study_topics (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 course_id uuid not null, title text not null, mastery text not null default 'unstudied' check(mastery in ('unstudied','practicing','needs_review','mastered')), notes text not null default '',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),foreign key(user_id,course_id) references public.courses(user_id,id)
);
create table public.study_sessions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 course_id uuid not null, topic_id uuid, task_id uuid, start_at timestamptz not null, end_at timestamptz not null, notes text not null default '',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),foreign key(user_id,course_id) references public.courses(user_id,id),foreign key(user_id,topic_id) references public.study_topics(user_id,id),foreign key(user_id,task_id) references public.tasks(user_id,id),check(end_at>start_at)
);
create table public.financial_accounts (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 name text not null, account_type text not null, currency char(3) not null default 'CAD', opening_balance numeric(14,2) not null default 0, archived_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id)
);
create table public.financial_categories (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 name text not null, category_type text not null check(category_type in ('income','expense')), archived_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),unique(user_id,name,category_type)
);
create table public.transactions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 account_id uuid not null, counterparty_account_id uuid, category_id uuid, transaction_date date not null, kind text not null check(kind in ('income','expense','transfer')), amount numeric(14,2) not null check(amount>0), description text not null default '', source_id uuid, source_key text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),foreign key(user_id,account_id) references public.financial_accounts(user_id,id),foreign key(user_id,counterparty_account_id) references public.financial_accounts(user_id,id),foreign key(user_id,category_id) references public.financial_categories(user_id,id),foreign key(user_id,source_id) references public.data_sources(user_id,id),check((kind='transfer' and counterparty_account_id is not null and counterparty_account_id<>account_id and category_id is null) or (kind<>'transfer' and counterparty_account_id is null)),unique(user_id,source_id,source_key)
);
create table public.budgets (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 category_id uuid, period_start date not null, period_end date not null, amount numeric(14,2) not null check(amount>=0), currency char(3) not null default 'CAD',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),foreign key(user_id,category_id) references public.financial_categories(user_id,id),check(period_end>=period_start)
);
create table public.savings_goals (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 name text not null, account_id uuid, target_amount numeric(14,2) not null check(target_amount>0), target_date date, currency char(3) not null default 'CAD',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),foreign key(user_id,account_id) references public.financial_accounts(user_id,id)
);
create table public.habits (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 title text not null, description text not null default '', tracking_type text not null default 'boolean' check(tracking_type in ('boolean','numeric')), unit text, archived_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id)
);
create table public.habit_entries (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 habit_id uuid not null, entry_date date not null, boolean_value boolean, numeric_value numeric, reflection text not null default '',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),foreign key(user_id,habit_id) references public.habits(user_id,id),unique(user_id,habit_id,entry_date),check(not(boolean_value is not null and numeric_value is not null))
);
create table public.contacts (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 name text not null, organization text, role text, email text, relationship_notes text not null default '', next_follow_up_date date, source_id uuid, source_key text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),foreign key(user_id,source_id) references public.data_sources(user_id,id),unique(user_id,source_id,source_key)
);
create table public.review_items (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 review_id uuid not null, area_id uuid, task_id uuid, goal_id uuid, item_type text not null, notes text not null default '',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),foreign key(user_id,review_id) references public.reviews(user_id,id),foreign key(user_id,area_id) references public.life_areas(user_id,id),foreign key(user_id,task_id) references public.tasks(user_id,id),foreign key(user_id,goal_id) references public.goals(user_id,id)
);
create table public.notifications (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 category text not null, title text not null, body text not null default '', deduplication_key text not null, scheduled_at timestamptz, delivered_at timestamptz, acknowledged_at timestamptz, delivery_status text not null default 'pending' check(delivery_status in ('pending','delivered','failed','suppressed')), channel text not null default 'in_app' check(channel in ('in_app','push')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),unique(user_id,deduplication_key)
);
create table public.notification_preferences (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 category text not null, in_app_enabled boolean not null default true, push_enabled boolean not null default false check(push_enabled=false), quiet_start time, quiet_end time, timezone text not null default 'America/Vancouver',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),unique(user_id,category)
);
create table public.export_jobs (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','running','completed','failed')), format text not null default 'json', finished_at timestamptz, expires_at timestamptz, error_summary text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id)
);
create table public.deletion_requests (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 requested_at timestamptz not null default now(), status text not null default 'requested' check(status in ('requested','cancelled','completed')), completed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id)
);
create table public.goal_projects (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 goal_id uuid not null,project_id uuid not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1,
 unique(user_id,id),foreign key(user_id,goal_id) references public.goals(user_id,id),foreign key(user_id,project_id) references public.projects(user_id,id),unique(user_id,goal_id,project_id)
);
alter table public.data_sources enable row level security;
revoke all on public.data_sources from public,anon,authenticated;
create policy own_records on public.data_sources for all to authenticated using(user_id=auth.uid() and public.is_approved_user()) with check(user_id=auth.uid() and public.is_approved_user());
grant select,insert,update,delete on public.data_sources to authenticated;
create trigger stamp before update on public.data_sources for each row execute function public.stamp_record();
create index data_sources_owner on public.data_sources(user_id);
alter table public.scheduling_policies enable row level security;
revoke all on public.scheduling_policies from public,anon,authenticated;
create policy own_records on public.scheduling_policies for all to authenticated using(user_id=auth.uid() and public.is_approved_user()) with check(user_id=auth.uid() and public.is_approved_user());
grant select,insert,update,delete on public.scheduling_policies to authenticated;
create trigger stamp before update on public.scheduling_policies for each row execute function public.stamp_record();
create index scheduling_policies_owner on public.scheduling_policies(user_id);
alter table public.academic_terms enable row level security;
revoke all on public.academic_terms from public,anon,authenticated;
create policy own_records on public.academic_terms for all to authenticated using(user_id=auth.uid() and public.is_approved_user()) with check(user_id=auth.uid() and public.is_approved_user());
grant select,insert,update,delete on public.academic_terms to authenticated;
create trigger stamp before update on public.academic_terms for each row execute function public.stamp_record();
create index academic_terms_owner on public.academic_terms(user_id);
alter table public.courses enable row level security;
revoke all on public.courses from public,anon,authenticated;
create policy own_records on public.courses for all to authenticated using(user_id=auth.uid() and public.is_approved_user()) with check(user_id=auth.uid() and public.is_approved_user());
grant select,insert,update,delete on public.courses to authenticated;
create trigger stamp before update on public.courses for each row execute function public.stamp_record();
create index courses_owner on public.courses(user_id);
alter table public.grading_categories enable row level security;
revoke all on public.grading_categories from public,anon,authenticated;
create policy own_records on public.grading_categories for all to authenticated using(user_id=auth.uid() and public.is_approved_user()) with check(user_id=auth.uid() and public.is_approved_user());
grant select,insert,update,delete on public.grading_categories to authenticated;
create trigger stamp before update on public.grading_categories for each row execute function public.stamp_record();
create index grading_categories_owner on public.grading_categories(user_id);
alter table public.assessments enable row level security;
revoke all on public.assessments from public,anon,authenticated;
create policy own_records on public.assessments for all to authenticated using(user_id=auth.uid() and public.is_approved_user()) with check(user_id=auth.uid() and public.is_approved_user());
grant select,insert,update,delete on public.assessments to authenticated;
create trigger stamp before update on public.assessments for each row execute function public.stamp_record();
create index assessments_owner on public.assessments(user_id);
alter table public.study_topics enable row level security;
revoke all on public.study_topics from public,anon,authenticated;
create policy own_records on public.study_topics for all to authenticated using(user_id=auth.uid() and public.is_approved_user()) with check(user_id=auth.uid() and public.is_approved_user());
grant select,insert,update,delete on public.study_topics to authenticated;
create trigger stamp before update on public.study_topics for each row execute function public.stamp_record();
create index study_topics_owner on public.study_topics(user_id);
alter table public.study_sessions enable row level security;
revoke all on public.study_sessions from public,anon,authenticated;
create policy own_records on public.study_sessions for all to authenticated using(user_id=auth.uid() and public.is_approved_user()) with check(user_id=auth.uid() and public.is_approved_user());
grant select,insert,update,delete on public.study_sessions to authenticated;
create trigger stamp before update on public.study_sessions for each row execute function public.stamp_record();
create index study_sessions_owner on public.study_sessions(user_id);
alter table public.financial_accounts enable row level security;
revoke all on public.financial_accounts from public,anon,authenticated;
create policy own_records on public.financial_accounts for all to authenticated using(user_id=auth.uid() and public.is_approved_user()) with check(user_id=auth.uid() and public.is_approved_user());
grant select,insert,update,delete on public.financial_accounts to authenticated;
create trigger stamp before update on public.financial_accounts for each row execute function public.stamp_record();
create index financial_accounts_owner on public.financial_accounts(user_id);
alter table public.financial_categories enable row level security;
revoke all on public.financial_categories from public,anon,authenticated;
create policy own_records on public.financial_categories for all to authenticated using(user_id=auth.uid() and public.is_approved_user()) with check(user_id=auth.uid() and public.is_approved_user());
grant select,insert,update,delete on public.financial_categories to authenticated;
create trigger stamp before update on public.financial_categories for each row execute function public.stamp_record();
create index financial_categories_owner on public.financial_categories(user_id);
alter table public.transactions enable row level security;
revoke all on public.transactions from public,anon,authenticated;
create policy own_records on public.transactions for all to authenticated using(user_id=auth.uid() and public.is_approved_user()) with check(user_id=auth.uid() and public.is_approved_user());
grant select,insert,update,delete on public.transactions to authenticated;
create trigger stamp before update on public.transactions for each row execute function public.stamp_record();
create index transactions_owner on public.transactions(user_id);
alter table public.budgets enable row level security;
revoke all on public.budgets from public,anon,authenticated;
create policy own_records on public.budgets for all to authenticated using(user_id=auth.uid() and public.is_approved_user()) with check(user_id=auth.uid() and public.is_approved_user());
grant select,insert,update,delete on public.budgets to authenticated;
create trigger stamp before update on public.budgets for each row execute function public.stamp_record();
create index budgets_owner on public.budgets(user_id);
alter table public.savings_goals enable row level security;
revoke all on public.savings_goals from public,anon,authenticated;
create policy own_records on public.savings_goals for all to authenticated using(user_id=auth.uid() and public.is_approved_user()) with check(user_id=auth.uid() and public.is_approved_user());
grant select,insert,update,delete on public.savings_goals to authenticated;
create trigger stamp before update on public.savings_goals for each row execute function public.stamp_record();
create index savings_goals_owner on public.savings_goals(user_id);
alter table public.habits enable row level security;
revoke all on public.habits from public,anon,authenticated;
create policy own_records on public.habits for all to authenticated using(user_id=auth.uid() and public.is_approved_user()) with check(user_id=auth.uid() and public.is_approved_user());
grant select,insert,update,delete on public.habits to authenticated;
create trigger stamp before update on public.habits for each row execute function public.stamp_record();
create index habits_owner on public.habits(user_id);
alter table public.habit_entries enable row level security;
revoke all on public.habit_entries from public,anon,authenticated;
create policy own_records on public.habit_entries for all to authenticated using(user_id=auth.uid() and public.is_approved_user()) with check(user_id=auth.uid() and public.is_approved_user());
grant select,insert,update,delete on public.habit_entries to authenticated;
create trigger stamp before update on public.habit_entries for each row execute function public.stamp_record();
create index habit_entries_owner on public.habit_entries(user_id);
alter table public.contacts enable row level security;
revoke all on public.contacts from public,anon,authenticated;
create policy own_records on public.contacts for all to authenticated using(user_id=auth.uid() and public.is_approved_user()) with check(user_id=auth.uid() and public.is_approved_user());
grant select,insert,update,delete on public.contacts to authenticated;
create trigger stamp before update on public.contacts for each row execute function public.stamp_record();
create index contacts_owner on public.contacts(user_id);
alter table public.review_items enable row level security;
revoke all on public.review_items from public,anon,authenticated;
create policy own_records on public.review_items for all to authenticated using(user_id=auth.uid() and public.is_approved_user()) with check(user_id=auth.uid() and public.is_approved_user());
grant select,insert,update,delete on public.review_items to authenticated;
create trigger stamp before update on public.review_items for each row execute function public.stamp_record();
create index review_items_owner on public.review_items(user_id);
alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from public,anon,authenticated;
create policy own_records on public.notification_preferences for all to authenticated using(user_id=auth.uid() and public.is_approved_user()) with check(user_id=auth.uid() and public.is_approved_user());
grant select,insert,update,delete on public.notification_preferences to authenticated;
create trigger stamp before update on public.notification_preferences for each row execute function public.stamp_record();
create index notification_preferences_owner on public.notification_preferences(user_id);
alter table public.goal_projects enable row level security;
revoke all on public.goal_projects from public,anon,authenticated;
create policy own_records on public.goal_projects for all to authenticated using(user_id=auth.uid() and public.is_approved_user()) with check(user_id=auth.uid() and public.is_approved_user());
grant select,insert,update,delete on public.goal_projects to authenticated;
create trigger stamp before update on public.goal_projects for each row execute function public.stamp_record();
create index goal_projects_owner on public.goal_projects(user_id);
alter table public.import_batches enable row level security;
revoke all on public.import_batches from public,anon,authenticated;
create policy own_records on public.import_batches for select to authenticated using(user_id=auth.uid() and public.is_approved_user());
grant select on public.import_batches to authenticated;
create trigger stamp before update on public.import_batches for each row execute function public.stamp_record();
create index import_batches_owner on public.import_batches(user_id);
alter table public.calendar_connections enable row level security;
revoke all on public.calendar_connections from public,anon,authenticated;
create policy own_records on public.calendar_connections for select to authenticated using(user_id=auth.uid() and public.is_approved_user());
grant select on public.calendar_connections to authenticated;
create trigger stamp before update on public.calendar_connections for each row execute function public.stamp_record();
create index calendar_connections_owner on public.calendar_connections(user_id);
alter table public.calendars enable row level security;
revoke all on public.calendars from public,anon,authenticated;
create policy own_records on public.calendars for select to authenticated using(user_id=auth.uid() and public.is_approved_user());
grant select on public.calendars to authenticated;
create trigger stamp before update on public.calendars for each row execute function public.stamp_record();
create index calendars_owner on public.calendars(user_id);
alter table public.calendar_events enable row level security;
revoke all on public.calendar_events from public,anon,authenticated;
create policy own_records on public.calendar_events for select to authenticated using(user_id=auth.uid() and public.is_approved_user());
grant select on public.calendar_events to authenticated;
create trigger stamp before update on public.calendar_events for each row execute function public.stamp_record();
create index calendar_events_owner on public.calendar_events(user_id);
alter table public.work_blocks enable row level security;
revoke all on public.work_blocks from public,anon,authenticated;
create policy own_records on public.work_blocks for select to authenticated using(user_id=auth.uid() and public.is_approved_user());
grant select on public.work_blocks to authenticated;
create trigger stamp before update on public.work_blocks for each row execute function public.stamp_record();
create index work_blocks_owner on public.work_blocks(user_id);
alter table public.scheduling_runs enable row level security;
revoke all on public.scheduling_runs from public,anon,authenticated;
create policy own_records on public.scheduling_runs for select to authenticated using(user_id=auth.uid() and public.is_approved_user());
grant select on public.scheduling_runs to authenticated;
create trigger stamp before update on public.scheduling_runs for each row execute function public.stamp_record();
create index scheduling_runs_owner on public.scheduling_runs(user_id);
alter table public.scheduling_decisions enable row level security;
revoke all on public.scheduling_decisions from public,anon,authenticated;
create policy own_records on public.scheduling_decisions for select to authenticated using(user_id=auth.uid() and public.is_approved_user());
grant select on public.scheduling_decisions to authenticated;
create trigger stamp before update on public.scheduling_decisions for each row execute function public.stamp_record();
create index scheduling_decisions_owner on public.scheduling_decisions(user_id);
alter table public.integration_jobs enable row level security;
revoke all on public.integration_jobs from public,anon,authenticated;
create policy own_records on public.integration_jobs for select to authenticated using(user_id=auth.uid() and public.is_approved_user());
grant select on public.integration_jobs to authenticated;
create trigger stamp before update on public.integration_jobs for each row execute function public.stamp_record();
create index integration_jobs_owner on public.integration_jobs(user_id);
alter table public.sync_cursors enable row level security;
revoke all on public.sync_cursors from public,anon,authenticated;
create policy own_records on public.sync_cursors for select to authenticated using(user_id=auth.uid() and public.is_approved_user());
grant select on public.sync_cursors to authenticated;
create trigger stamp before update on public.sync_cursors for each row execute function public.stamp_record();
create index sync_cursors_owner on public.sync_cursors(user_id);
alter table public.integration_conflicts enable row level security;
revoke all on public.integration_conflicts from public,anon,authenticated;
create policy own_records on public.integration_conflicts for select to authenticated using(user_id=auth.uid() and public.is_approved_user());
grant select on public.integration_conflicts to authenticated;
create trigger stamp before update on public.integration_conflicts for each row execute function public.stamp_record();
create index integration_conflicts_owner on public.integration_conflicts(user_id);
alter table public.notifications enable row level security;
revoke all on public.notifications from public,anon,authenticated;
create policy own_records on public.notifications for select to authenticated using(user_id=auth.uid() and public.is_approved_user());
grant select on public.notifications to authenticated;
create trigger stamp before update on public.notifications for each row execute function public.stamp_record();
create index notifications_owner on public.notifications(user_id);
alter table public.export_jobs enable row level security;
revoke all on public.export_jobs from public,anon,authenticated;
create policy own_records on public.export_jobs for select to authenticated using(user_id=auth.uid() and public.is_approved_user());
grant select on public.export_jobs to authenticated;
create trigger stamp before update on public.export_jobs for each row execute function public.stamp_record();
create index export_jobs_owner on public.export_jobs(user_id);
alter table public.deletion_requests enable row level security;
revoke all on public.deletion_requests from public,anon,authenticated;
create policy own_records on public.deletion_requests for select to authenticated using(user_id=auth.uid() and public.is_approved_user());
grant select on public.deletion_requests to authenticated;
create trigger stamp before update on public.deletion_requests for each row execute function public.stamp_record();
create index deletion_requests_owner on public.deletion_requests(user_id);
create trigger audit after insert or update or delete on public.academic_terms for each row execute function public.audit_record();
create trigger audit after insert or update or delete on public.courses for each row execute function public.audit_record();
create trigger audit after insert or update or delete on public.assessments for each row execute function public.audit_record();
create trigger audit after insert or update or delete on public.transactions for each row execute function public.audit_record();
create trigger audit after insert or update or delete on public.budgets for each row execute function public.audit_record();
create trigger audit after insert or update or delete on public.contacts for each row execute function public.audit_record();
create trigger audit after insert or update or delete on public.goal_projects for each row execute function public.audit_record();
create index job_ready on public.integration_jobs(user_id,status,next_attempt_at);
create index calendar_events_range on public.calendar_events(user_id,calendar_id,start_at,end_at);
create index work_blocks_range on public.work_blocks(user_id,start_at,end_at);
create index assessments_deadline on public.assessments(user_id,due_date,due_at);
create index transactions_period on public.transactions(user_id,transaction_date);
-- Same-owner foreign keys are necessary but not sufficient for nested relationships.
alter table public.grading_categories add unique(user_id,course_id,id);
alter table public.assessments add foreign key(user_id,course_id,category_id) references public.grading_categories(user_id,course_id,id);
alter table public.study_topics add unique(user_id,course_id,id);
alter table public.study_sessions add foreign key(user_id,course_id,topic_id) references public.study_topics(user_id,course_id,id);
alter table public.task_occurrences add unique(user_id,task_id,id);
alter table public.work_blocks add foreign key(user_id,task_id,occurrence_id) references public.task_occurrences(user_id,task_id,id);
alter table public.calendars add unique(user_id,connection_id,id);
alter table public.sync_cursors add foreign key(user_id,connection_id,calendar_id) references public.calendars(user_id,connection_id,id);
create function public.validate_financial_transaction() returns trigger language plpgsql set search_path='' as $$
declare category_kind text; account_currency text; other_currency text;
begin
 if new.category_id is not null then
  select category_type into category_kind from public.financial_categories where user_id=new.user_id and id=new.category_id;
  if category_kind is distinct from new.kind then raise exception 'Category does not match transaction type' using errcode='23514'; end if;
 end if;
 if new.kind='transfer' then
  select currency into account_currency from public.financial_accounts where user_id=new.user_id and id=new.account_id;
  select currency into other_currency from public.financial_accounts where user_id=new.user_id and id=new.counterparty_account_id;
  if account_currency is not null and other_currency is not null and account_currency<>other_currency then raise exception 'Cross-currency transfers require an explicit exchange model' using errcode='23514'; end if;
 end if;
 return new;
end; $$;
create trigger financial_transaction_check before insert or update on public.transactions for each row execute function public.validate_financial_transaction();
