-- Each export leaves a small receipt (what left, when, how big) so Settings
-- can show the last one. The owner may only add receipts for themselves.
alter table public.export_jobs add column if not exists summary jsonb;
grant insert (user_id, status, format, finished_at, summary) on public.export_jobs to authenticated;
drop policy if exists own_receipts on public.export_jobs;
create policy own_receipts on public.export_jobs for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved_user());
