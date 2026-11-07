create table public.assistant_settings(user_id uuid primary key references auth.users(id)on delete cascade,enabled boolean not null default false,free_plan_confirmed boolean not null default false,daily_limit integer not null default 10 check(daily_limit between 1 and 20),last_request_at timestamptz,check(not enabled or free_plan_confirmed));
create table public.assistant_conversations(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id)on delete cascade,title text not null check(length(title)between 1 and 100),course_canvas_id text,created_at timestamptz not null default now(),unique(user_id,id));
create table public.assistant_exchanges(id uuid primary key,user_id uuid not null references auth.users(id)on delete cascade,conversation_id uuid not null,question text not null check(length(question)between 1 and 1500),status text not null default 'pending'check(status in ('pending','completed','failed')),response jsonb,sources jsonb not null default '[]',error text,input_tokens integer,output_tokens integer,created_at timestamptz not null default now(),finished_at timestamptz,foreign key(user_id,conversation_id)references public.assistant_conversations(user_id,id)on delete cascade);
create table public.assistant_usage(user_id uuid not null references auth.users(id)on delete cascade,usage_day date not null,requests integer not null default 0,reserved_tokens integer not null default 0,primary key(user_id,usage_day));
create index assistant_exchange_history on public.assistant_exchanges(user_id,conversation_id,created_at);
create index assistant_conversation_history on public.assistant_conversations(user_id,created_at desc);
do $$declare t text;begin foreach t in array array['assistant_settings','assistant_conversations','assistant_exchanges','assistant_usage']loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create policy owner_read on public.%I for select to authenticated using(user_id=auth.uid() and public.is_approved_user())',t);
 end loop;end$$;
grant delete on public.assistant_conversations to authenticated;
create policy owner_delete on public.assistant_conversations for delete to authenticated using(user_id=auth.uid()and public.is_approved_user());
create function public.set_my_assistant(p_enabled boolean,p_free boolean,p_limit integer)returns void language plpgsql security definer set search_path='' as $$begin
 if not public.is_approved_user()then raise exception 'Unauthorized'using errcode='42501';end if;
 insert into public.assistant_settings(user_id,enabled,free_plan_confirmed,daily_limit)values(auth.uid(),p_enabled,p_free,p_limit)on conflict(user_id)do update set enabled=excluded.enabled,free_plan_confirmed=excluded.free_plan_confirmed,daily_limit=excluded.daily_limit;end$$;
revoke all on function public.set_my_assistant(boolean,boolean,integer)from public,anon;
grant execute on function public.set_my_assistant(boolean,boolean,integer)to authenticated;
create function public.claim_assistant_request(p_request uuid,p_conversation uuid,p_course text,p_question text)returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid();settings public.assistant_settings;old public.assistant_exchanges;c public.assistant_conversations;day date:=(now()at time zone 'America/Vancouver')::date;used integer;begin
 if owner is null or not public.is_approved_user()then raise exception 'Unauthorized'using errcode='42501';end if;
 if p_request is null or p_question is null or length(p_question)not between 1 and 1500 then raise exception 'Invalid assistant input'using errcode='22023';end if;
 select * into settings from public.assistant_settings where user_id=owner for update;
 if not found or not settings.enabled or not settings.free_plan_confirmed then raise exception 'Enable the assistant and confirm the Free plan first'using errcode='42501';end if;
 select * into old from public.assistant_exchanges where id=p_request;
 if found then
  if old.user_id<>owner or old.question<>p_question or (select course_canvas_id from public.assistant_conversations where id=old.conversation_id) is distinct from p_course or(p_conversation is not null and old.conversation_id<>p_conversation)then raise exception 'Request identity conflict'using errcode='40001';end if;
  return jsonb_build_object('id',old.id,'conversation_id',old.conversation_id,'status',old.status,'response',old.response,'sources',old.sources,'replayed',true);
 end if;
 if settings.last_request_at>now()-interval '61 seconds'then raise exception 'Wait at least one minute between AI requests'using errcode='P0001';end if;
 insert into public.assistant_usage(user_id,usage_day)values(owner,day)on conflict do nothing;
 select requests into used from public.assistant_usage where user_id=owner and usage_day=day for update;
 if used>=settings.daily_limit then raise exception 'Daily assistant allowance reached'using errcode='P0001';end if;
 if p_conversation is null then
  if p_course is not null and not exists(select 1 from public.canvas_records where user_id=owner and resource_type='course'and canvas_id=p_course)then raise exception 'Unknown owned course'using errcode='22023';end if;
  insert into public.assistant_conversations(user_id,title,course_canvas_id)values(owner,left(p_question,100),p_course)returning * into c;
 else
  select * into c from public.assistant_conversations where user_id=owner and id=p_conversation for update;
  if not found or c.course_canvas_id is distinct from p_course then raise exception 'Conversation not found or course changed'using errcode='P0002';end if;
 end if;
 insert into public.assistant_exchanges(id,user_id,conversation_id,question)values(p_request,owner,c.id,p_question);
 update public.assistant_usage set requests=requests+1,reserved_tokens=reserved_tokens+8000 where user_id=owner and usage_day=day;
 update public.assistant_settings set last_request_at=now()where user_id=owner;
 return jsonb_build_object('id',p_request,'conversation_id',c.id,'status','pending','replayed',false);
end$$;
revoke all on function public.claim_assistant_request(uuid,uuid,text,text)from public,anon;
grant execute on function public.claim_assistant_request(uuid,uuid,text,text)to authenticated;
