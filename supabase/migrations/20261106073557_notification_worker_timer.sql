-- Extension availability differs in isolated test engines. Hosted Supabase supports these.
-- No timer is activated here; deployment registers it after the worker passes a smoke check.
do $$begin
 if exists(select 1 from pg_available_extensions where name='pg_cron') then execute 'create extension if not exists pg_cron'; end if;
 if exists(select 1 from pg_available_extensions where name='pg_net') then execute 'create extension if not exists pg_net with schema extensions'; end if;
end$$;
create function public.configure_notification_timer(p_secret text) returns boolean language plpgsql security definer set search_path='' as $$
declare secret_id uuid;
begin
 if length(p_secret)<40 then raise exception 'Invalid worker secret'; end if;
 if not exists(select 1 from pg_namespace where nspname='cron') or not exists(select 1 from pg_namespace where nspname='vault') then raise exception 'Notification timer extensions unavailable'; end if;
 select id into secret_id from vault.secrets where name='lifeos_notification_worker';
 if secret_id is null then perform vault.create_secret(p_secret,'lifeos_notification_worker','Narrow credential for Life OS reminders only.');
 else perform vault.update_secret(secret_id,p_secret); end if;
 perform cron.schedule('lifeos-notifications','*/15 * * * *',$command$
  select net.http_post(
   url:='https://lifeos-beta-ivory.vercel.app/api/internal/notifications',
   headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='lifeos_notification_worker')),
   body:='{}'::jsonb,timeout_milliseconds:=12000
  );
 $command$);
 return true;
end$$;
revoke all on function public.configure_notification_timer(text) from public,anon,authenticated;
grant execute on function public.configure_notification_timer(text) to service_role;
do $$begin
 if exists(select 1 from pg_namespace where nspname='net') then
  execute 'revoke all on schema net from public,anon,authenticated';
  execute 'revoke all on all tables in schema net from public,anon,authenticated';
 end if;
end$$;
