-- Supabase owns pg_net grants. Never put a long-lived bearer secret in its request queue.
create or replace function public.configure_notification_timer(p_secret text) returns boolean language plpgsql security definer set search_path='' as $$
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
   headers:=jsonb_build_object('Content-Type','application/json',
     'x-lifeos-timestamp',floor(extract(epoch from now()))::text,
     'x-lifeos-signature',encode(extensions.hmac(
       convert_to('lifeos-notifications:'||floor(extract(epoch from now()))::text,'UTF8'),
       convert_to((select decrypted_secret from vault.decrypted_secrets where name='lifeos_notification_worker'),'UTF8'),
       'sha256'),'hex')
   ),
   body:='{}'::jsonb,timeout_milliseconds:=120000
  );
 $command$);
 return true;
end$$;
revoke all on function public.configure_notification_timer(text) from public,anon,authenticated;
grant execute on function public.configure_notification_timer(text) to service_role;

-- Update the existing cron command without reading a secret into application logs.
do $$declare command text;begin
 if to_regclass('cron.job')is not null then
  select j.command into command from cron.job j where jobname='lifeos-notifications';
  if command is not null then perform cron.schedule('lifeos-notifications','*/15 * * * *',regexp_replace(command,'timeout_milliseconds\s*:=\s*12000\M','timeout_milliseconds:=120000'));end if;
 end if;
end$$;
