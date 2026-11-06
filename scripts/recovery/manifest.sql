-- Aggregate fingerprints only. Source rows and Auth credential values are never printed.
with candidate_tables as (
 select table_schema,table_name from information_schema.tables
 where table_type='BASE TABLE' and table_schema in ('public','private','auth')
 and not(table_schema='auth' and table_name='schema_migrations')
), table_fingerprints as (
 select table_schema||'.'||table_name as name,
 ((xpath('/row/value/text()',query_to_xml(format($query$
 select jsonb_build_object('count',count(*),'fingerprint',encode(sha256(convert_to(coalesce(string_agg(row_hash,'' order by row_hash),''),'UTF8')),'hex'))::text as value
 from (select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') as row_hash from %I.%I t) rows
 $query$,table_schema,table_name),false,true,'')))[1]::text)::jsonb as value
 from candidate_tables
)
select jsonb_build_object(
 'format','life-os-database-manifest','version',1,
 'database_major',current_setting('server_version_num')::integer/10000,
 'tables',coalesce((select jsonb_object_agg(name,value order by name) from table_fingerprints),'{}'::jsonb),
 'auth_columns',coalesce((select jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'type',udt_name,'position',ordinal_position) order by table_name,ordinal_position) from information_schema.columns where table_schema='auth' and table_name<>'schema_migrations'),'[]'::jsonb),
 'security',jsonb_build_object(
  'rls',coalesce((select jsonb_agg(jsonb_build_object('table',n.nspname||'.'||c.relname,'enabled',c.relrowsecurity,'forced',c.relforcerowsecurity) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r'),'[]'::jsonb),
  'policies',coalesce((select jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',policyname,'roles',roles,'command',cmd,'using',qual,'check',with_check) order by schemaname,tablename,policyname) from pg_policies where schemaname in ('public','private')),'[]'::jsonb),
  'grants',coalesce((select jsonb_agg(jsonb_build_object('schema',table_schema,'table',table_name,'role',grantee,'privilege',privilege_type) order by table_schema,table_name,grantee,privilege_type) from information_schema.role_table_grants where table_schema in ('public','private') and grantee in ('anon','authenticated')),'[]'::jsonb)
 ),
 'unsupported',jsonb_build_object(
  'storage_objects',(select count(*) from storage.objects),
  'vault_secrets',case when to_regclass('vault.secrets') is null then 0 else ((xpath('/row/count/text()',query_to_xml('select count(*) as count from vault.secrets',false,true,'')))[1]::text)::bigint end,
  'mfa_factors',(select count(*) from auth.mfa_factors)
 )
) as manifest;
