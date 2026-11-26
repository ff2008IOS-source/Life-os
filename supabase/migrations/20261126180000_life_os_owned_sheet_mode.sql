-- Life OS becomes the source of truth for selected tables from owner_since onward.
-- Additive: existing datasets keep their mode. Rows first seen before owner_since stay frozen history.
alter table public.sheet_rest_datasets drop constraint if exists sheet_rest_datasets_mode_check;
alter table public.sheet_rest_datasets add constraint sheet_rest_datasets_mode_check
 check(mode in('import_only','export_only','two_way','life_os_owned','paused'));
alter table public.sheet_rest_datasets add column if not exists owner_since timestamptz;
alter table public.sheet_rest_datasets add constraint sheet_rest_owned_needs_date
 check(mode<>'life_os_owned' or owner_since is not null);
