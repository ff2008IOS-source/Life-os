alter table public.notification_preferences drop constraint notification_preferences_push_enabled_check;
create table public.push_subscriptions (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null, keys jsonb not null, created_at timestamptz not null default now(),
 unique(user_id,endpoint)
);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public,anon,authenticated;
grant all on public.push_subscriptions to service_role;
-- Device credentials are intentionally inaccessible through authenticated Data API calls.
create table public.notification_delivery_attempts (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 notification_id uuid not null,subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','sending','delivered','failed')), attempts integer not null default 0,
 lease_until timestamptz,last_error text,unique(notification_id,subscription_id),
 foreign key(user_id,notification_id) references public.notifications(user_id,id)
);
alter table public.notification_delivery_attempts enable row level security;
revoke all on public.notification_delivery_attempts from public,anon,authenticated;
grant all on public.notification_delivery_attempts to service_role;
create function public.claim_notification_delivery(p_id uuid) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 update public.notification_delivery_attempts set status='sending',attempts=attempts+1,lease_until=now()+interval '2 minutes'
 where id=p_id and attempts<3 and (status in ('pending','failed') or(status='sending' and lease_until<now()));
 return found;
end $$;
revoke all on function public.claim_notification_delivery(uuid) from public,anon,authenticated;
grant execute on function public.claim_notification_delivery(uuid) to service_role;
