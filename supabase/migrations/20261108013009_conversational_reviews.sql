alter table public.reviews add column conversation_summary text not null default '' check(length(conversation_summary)<=10000);
create table public.review_chat_links(
 user_id uuid not null,review_id uuid not null,conversation_id uuid not null,
 primary key(user_id,review_id),unique(user_id,conversation_id),
 foreign key(user_id,review_id)references public.reviews(user_id,id)on delete cascade,
 foreign key(user_id,conversation_id)references public.assistant_conversations(user_id,id)on delete cascade
);
alter table public.review_chat_links enable row level security;
revoke all on public.review_chat_links from public,anon,authenticated;
grant select on public.review_chat_links to authenticated;
grant all on public.review_chat_links to service_role;
create policy owner_read on public.review_chat_links for select to authenticated using(user_id=(select auth.uid())and public.is_approved_user());
-- Server-only invoker RPC: explicit narrow privileges, no new definer bypass.
grant usage on schema private to service_role;
grant select on private.approved_users to service_role;
grant select,update on public.reviews to service_role;
create function public.ensure_review_chat(p_user uuid,p_review uuid)returns uuid language plpgsql security invoker set search_path=''as $$
declare r public.reviews;c uuid;begin
 if not exists(select 1 from private.approved_users where user_id=p_user)then raise exception 'Unapproved owner'using errcode='42501';end if;
 select *into r from public.reviews where user_id=p_user and id=p_review for update;
 if not found then raise exception 'Owned review missing'using errcode='42501';end if;
 select conversation_id into c from public.review_chat_links where user_id=p_user and review_id=p_review;
 if c is not null then return c;end if;
 insert into public.assistant_conversations(user_id,title)values(p_user,'Weekly review · '||r.period_start::text)returning id into c;
 insert into public.review_chat_links(user_id,review_id,conversation_id)values(p_user,p_review,c);
 return c;
end$$;
revoke all on function public.ensure_review_chat(uuid,uuid)from public,anon,authenticated;
grant execute on function public.ensure_review_chat(uuid,uuid)to service_role;
