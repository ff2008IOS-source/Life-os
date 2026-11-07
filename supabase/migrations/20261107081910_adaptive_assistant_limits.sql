-- Adaptive, durable request accounting. Daily owner allowance is unchanged.
alter table public.assistant_settings add column provider_retry_until timestamptz;
create table public.assistant_request_limits(id uuid primary key,user_id uuid not null references auth.users(id)on delete cascade,budget integer not null check(budget between 1 and 8000),actual_tokens integer check(actual_tokens>=0),state text not null check(state in ('pending','completed','failed','rejected')),created_at timestamptz not null default now());
alter table public.assistant_request_limits enable row level security;
revoke all on public.assistant_request_limits from public,anon,authenticated;
grant select on public.assistant_request_limits to authenticated;
grant all on public.assistant_request_limits to service_role;
create policy owner_read on public.assistant_request_limits for select to authenticated using(user_id=auth.uid()and public.is_approved_user());
create index assistant_limits_window on public.assistant_request_limits(user_id,created_at);
insert into public.assistant_request_limits(id,user_id,budget,actual_tokens,state,created_at)select id,user_id,8000,case when input_tokens is not null and output_tokens is not null then input_tokens+output_tokens end,status,created_at from public.assistant_exchanges;
create function public.assistant_rate_status()returns jsonb language plpgsql security definer set search_path=''as $$
declare owner uuid:=auth.uid();s public.assistant_settings;used integer;minute_tokens integer;pending boolean;retry timestamptz;reason text;reset timestamptz;begin
 if owner is null or not public.is_approved_user()then raise exception 'Unauthorized'using errcode='42501';end if;
 select * into s from public.assistant_settings where user_id=owner;
 select coalesce(requests,0)into used from public.assistant_usage where user_id=owner and usage_day=(now()at time zone 'America/Vancouver')::date;used:=coalesce(used,0);
 select coalesce(sum(coalesce(actual_tokens,budget)),0),min(created_at)+interval '61 seconds'into minute_tokens,retry from public.assistant_request_limits where user_id=owner and created_at>now()-interval '61 seconds';
 select exists(select 1 from public.assistant_request_limits where user_id=owner and state='pending'and created_at>now()-interval '120 seconds')into pending;
 reset:=(((now()at time zone 'America/Vancouver')::date+1)::timestamp at time zone 'America/Vancouver');
 if not coalesce(s.enabled,false)then reason:='disabled';retry:=null;
 elsif used>=coalesce(s.daily_limit,10)then reason:='daily';retry:=reset;
 elsif s.provider_retry_until>now()then reason:='provider';retry:=case when minute_tokens>5000 then greatest(s.provider_retry_until,coalesce(retry,s.provider_retry_until))else s.provider_retry_until end;
 elsif pending then reason:='busy';
 elsif minute_tokens>5000 then reason:='tokens';
 end if;
 return jsonb_build_object('available_tokens',greatest(0,8000-minute_tokens),'remaining_requests',greatest(0,coalesce(s.daily_limit,10)-used),'daily_limit',coalesce(s.daily_limit,10),'reason',reason,'retry_at',retry,'reset_at',reset);
end$$;
revoke all on function public.assistant_rate_status()from public,anon;
grant execute on function public.assistant_rate_status()to authenticated;
create function public.claim_assistant_request_v2(p_request uuid,p_conversation uuid,p_course text,p_question text,p_budget integer)returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid();settings public.assistant_settings;old public.assistant_exchanges;c public.assistant_conversations;day date:=(now()at time zone 'America/Vancouver')::date;used integer;rate jsonb;begin
 if owner is null or not public.is_approved_user()then raise exception 'Unauthorized'using errcode='42501';end if;
 if p_request is null or p_question is null or length(p_question)not between 1 and 1500 then raise exception 'Invalid assistant input'using errcode='22023';end if;
 select * into settings from public.assistant_settings where user_id=owner for update;
 if not found or not settings.enabled or not settings.free_plan_confirmed then raise exception 'Enable the assistant and confirm the Free plan first'using errcode='42501';end if;
 select * into old from public.assistant_exchanges where id=p_request;
 if found then
  if old.user_id<>owner or old.question<>p_question or (select course_canvas_id from public.assistant_conversations where id=old.conversation_id) is distinct from p_course or(p_conversation is not null and old.conversation_id<>p_conversation)then raise exception 'Request identity conflict'using errcode='40001';end if;
  return jsonb_build_object('id',old.id,'conversation_id',old.conversation_id,'status',old.status,'response',old.response,'sources',old.sources,'replayed',true);
 end if;
 if p_budget is null or p_budget not between 1000 and 8000 then raise exception 'Invalid request budget'using errcode='22023';end if;
 rate:=public.assistant_rate_status();
 if rate->>'reason' in ('daily','provider','busy')or p_budget>(rate->>'available_tokens')::integer then raise exception 'Assistant allowance temporarily unavailable'using errcode='P0001',detail=rate::text;end if;
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
 update public.assistant_usage set requests=requests+1,reserved_tokens=reserved_tokens+p_budget where user_id=owner and usage_day=day;
 insert into public.assistant_request_limits(id,user_id,budget,state)values(p_request,owner,p_budget,'pending');
 update public.assistant_settings set last_request_at=now()where user_id=owner;
 return jsonb_build_object('id',p_request,'conversation_id',c.id,'status','pending','replayed',false);
end$$;
revoke all on function public.claim_assistant_request_v2(uuid,uuid,text,text,integer)from public,anon;
grant execute on function public.claim_assistant_request_v2(uuid,uuid,text,text,integer)to authenticated;
create or replace function public.claim_assistant_request(p_request uuid,p_conversation uuid,p_course text,p_question text)returns jsonb language sql security invoker set search_path=''as $$select public.claim_assistant_request_v2(p_request,p_conversation,p_course,p_question,8000)$$;
