-- Keep the original columns and security-invoker ownership. Submission status is
-- distinct from grades and task completion; newer self-submission snapshots win.
create or replace view public.canvas_deadlines with(security_invoker=true) as
select r.user_id,r.canvas_id,r.course_canvas_id,r.payload->>'name' as title,(r.payload->>'due_at')::timestamptz as due_at,r.synced_at,m.conflict,x.task_id,coalesce(c.code,cc.payload->>'course_code') as course_code,
 case
 when s.payload->>'excused'='true' then 'excused'
 when s.payload->>'missing'='true' and (s.payload->>'submitted_at' is not null or s.payload->>'workflow_state' in('submitted','pending_review')) then 'needs_review'
 when s.payload->>'submitted_at' is not null or s.payload->>'workflow_state' in('submitted','pending_review') then 'submitted'
 when s.payload->>'missing'='true' then 'missing'
 when s.payload->>'workflow_state'='unsubmitted' then 'unsubmitted'
 when s.payload->>'workflow_state'='graded' then 'graded'
 else 'unknown' end as submission_state,
 s.synced_at as submission_synced_at,
 case when s.payload->>'late' in('true','false') then (s.payload->>'late')::boolean end as late,
 case when r.payload->>'published' in('true','false') then (r.payload->>'published')::boolean end as published
from public.canvas_records r
left join public.canvas_mappings m on m.user_id=r.user_id and m.resource_type=r.resource_type and m.canvas_id=r.canvas_id
left join public.assessments x on x.user_id=m.user_id and x.id=m.local_id
left join public.courses c on c.user_id=x.user_id and c.id=x.course_id
left join public.canvas_records cc on cc.user_id=r.user_id and cc.resource_type='course' and cc.canvas_id=r.course_canvas_id
left join lateral (
 select q.payload,q.synced_at from (
  select r.payload->'submission' as payload,r.synced_at,0 as priority where jsonb_typeof(r.payload->'submission')='object'
  union all
  select sr.payload,sr.synced_at,1 as priority from public.canvas_records sr
  where sr.user_id=r.user_id and sr.resource_type='submission' and sr.course_canvas_id=r.course_canvas_id and split_part(sr.canvas_id,':',2)=r.payload->>'id'
 )q order by q.synced_at desc,q.priority desc limit 1
)s on true
where r.resource_type='assignment' and r.payload->>'due_at' is not null;
