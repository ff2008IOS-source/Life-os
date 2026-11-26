-- Small display preferences saved to the account (not the browser), so a
-- choice made on one device holds on every device: calendar view, hidden
-- calendars, the Week filters, technical details, the sidebar, and which
-- Today suggestions were skipped today.
alter table public.profiles
  add column ui_preferences jsonb not null default '{}'::jsonb
  check (
    jsonb_typeof(ui_preferences) = 'object'
    and octet_length(ui_preferences::text) <= 16384
  );

-- One preference at a time, merged in place, so two quick changes can't
-- overwrite each other.
create or replace function public.set_ui_preference(p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not public.is_approved_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- A new account has no profile row until it saves something.
  insert into public.profiles (user_id, ui_preferences)
  values (auth.uid(), jsonb_build_object(p_key, p_value))
  on conflict (user_id) do update
    set ui_preferences = public.profiles.ui_preferences || excluded.ui_preferences
  returning ui_preferences into result;
  return result;
end;
$$;
revoke all on function public.set_ui_preference(text, jsonb) from public, anon;
grant execute on function public.set_ui_preference(text, jsonb) to authenticated;

-- Rollback:
--   drop function if exists public.set_ui_preference(text, jsonb);
--   alter table public.profiles drop column ui_preferences;
