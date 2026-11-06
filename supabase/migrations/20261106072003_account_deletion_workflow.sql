alter table public.deletion_requests add column execute_after timestamptz,add column last_error text,add column claimed_at timestamptz;
create unique index deletion_requests_one_pending on public.deletion_requests(user_id) where status='requested';
-- Clients can inspect their request but only password/MFA-checked server routes
-- may request, cancel or execute account deletion.
revoke insert,update,delete on public.deletion_requests from authenticated;
