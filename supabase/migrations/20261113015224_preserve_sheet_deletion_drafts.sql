-- Deletion is an outgoing intent, not permission to erase the local copy before confirmation.
create or replace function public.edit_sheet_rest(p_user uuid,p_dataset uuid,p_row uuid,p_version integer,p_request uuid,p_type text,p_values jsonb,p_key text,p_key_values jsonb)returns uuid language plpgsql security invoker set search_path=''as $$
declare d public.sheet_rest_datasets;r public.sheet_rest_rows;o public.sheet_rest_operations;f text;c jsonb;v jsonb;begin
 if not exists(select 1 from private.approved_users where user_id=p_user)then raise exception 'Unapproved owner'using errcode='42501';end if;
 select * into d from public.sheet_rest_datasets where user_id=p_user and id=p_dataset for update;
 if not found then raise exception 'Owned dataset missing'using errcode='42501';end if;
 if d.lease_until>now()then raise exception 'Source synchronization is running'using errcode='55P03';end if;
 select * into o from public.sheet_rest_operations where user_id=p_user and id=p_request;
 if found then
  if o.dataset_id<>p_dataset or o.row_id<>p_row or o.intended<>p_values or o.operation_type<>p_type then raise exception 'Request identity reused'using errcode='40001';end if;return o.id;
 end if;
 if exists(select 1 from public.sheet_rest_operations where user_id=p_user and row_id=p_row and status in('writing','unknown'))then raise exception 'Reconcile the uncertain write before editing again'using errcode='40001';end if;
 if p_type not in('update','insert','delete')or jsonb_typeof(p_values)<>'object'then raise exception 'Invalid edit'using errcode='22023';end if;
 if p_type='insert'then
  if not coalesce((d.config->>'allow_insert')::boolean,false)or p_key is null or p_key_values is null then raise exception 'Insert is not authorized for this table'using errcode='42501';end if;
  insert into public.sheet_rest_rows(id,user_id,dataset_id,external_key,key_values,local_values,state)values(p_row,p_user,p_dataset,p_key,p_key_values,p_values,'draft_new')returning *into r;
 else
  select * into r from public.sheet_rest_rows where user_id=p_user and dataset_id=p_dataset and id=p_row for update;
  if not found or r.version<>p_version then raise exception 'Owned record changed'using errcode='40001';end if;
  if r.state in('source_missing','deleted')or r.conflicts<>'{}'::jsonb then raise exception 'Source record is missing; review it first'using errcode='40001';end if;
  if p_type='delete'and not coalesce((d.config->>'allow_delete')::boolean,false)then raise exception 'Deletion is not authorized for this table'using errcode='42501';end if;
 end if;
 for f in select jsonb_object_keys(p_values)loop
  select value into c from jsonb_array_elements(d.config->'columns')where value->>'key'=f;
  if not found then raise exception 'Unmapped field'using errcode='42501';end if;
  if p_type='update'and(not coalesce((c->>'writable')::boolean,false)or coalesce((c->>'key_part')::boolean,false)or not coalesce((r.remote_cells->f->>'writable')::boolean,false))then raise exception 'This field is read only'using errcode='42501';end if;
 end loop;
 update public.sheet_rest_operations set status='superseded'where user_id=p_user and row_id=p_row and status in('draft','approved','failed','conflict');
 if p_type='update'then update public.sheet_rest_rows set local_values=local_values||p_values,state='pending'where id=p_row;elsif p_type='delete'then update public.sheet_rest_rows set state='pending'where id=p_row;end if;
 insert into public.sheet_rest_operations(id,user_id,dataset_id,row_id,operation_type,intended,expected_cells,status,approved_at)values(p_request,p_user,p_dataset,p_row,p_type,p_values,r.baseline,case when d.automatic_outbound and d.outbound_enabled then 'approved'else 'draft'end,case when d.automatic_outbound and d.outbound_enabled then now()end);
 insert into public.audit_logs(user_id,entity_type,entity_id,action,old_values,new_values)values(p_user,'sheet_rest_rows',p_row,'draft_'||p_type,r.local_values,p_values);
 return p_request;
end$$;
