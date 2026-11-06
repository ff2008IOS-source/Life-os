-- COPY restore disables triggers temporarily. Explicitly verify every application
-- foreign key afterward instead of trusting the pre-existing convalidated flag.
do $check$
declare relation record; invalid boolean;
begin
 for relation in
  select src_namespace.nspname as source_schema,src.relname as source_table,
         dst_namespace.nspname as target_schema,dst.relname as target_table,
         columns.not_null,columns.matches
  from pg_constraint constraint_record
  join pg_class src on src.oid=constraint_record.conrelid
  join pg_namespace src_namespace on src_namespace.oid=src.relnamespace
  join pg_class dst on dst.oid=constraint_record.confrelid
  join pg_namespace dst_namespace on dst_namespace.oid=dst.relnamespace
  cross join lateral (
   select string_agg(format('s.%I is not null',source_column.attname),' and ' order by fields.position) as not_null,
          string_agg(format('t.%I=s.%I',target_column.attname,source_column.attname),' and ' order by fields.position) as matches
   from unnest(constraint_record.conkey,constraint_record.confkey) with ordinality as fields(source_key,target_key,position)
   join pg_attribute source_column on source_column.attrelid=src.oid and source_column.attnum=fields.source_key
   join pg_attribute target_column on target_column.attrelid=dst.oid and target_column.attnum=fields.target_key
  ) columns
  where constraint_record.contype='f' and src_namespace.nspname in ('public','private')
 loop
  execute format('select exists(select 1 from %I.%I s where %s and not exists(select 1 from %I.%I t where %s))',relation.source_schema,relation.source_table,relation.not_null,relation.target_schema,relation.target_table,relation.matches) into invalid;
  if invalid then raise exception 'Restored foreign-key validation failed' using errcode='23503'; end if;
 end loop;
end;
$check$;
select to_json(true);
