# Export, backup, and recovery

## Current verification boundary

The JSON download is a user export, not a transactionally consistent complete backup. It excludes Auth identities, secrets and provider credentials. The app does not claim automatic backups. A complete hosted recovery rehearsal remains outstanding; previous imports do not prove disaster recovery. An independent PGlite database snapshot has been restored into a second engine and checked for record/audit counts and cross-user RLS. This establishes only local PostgreSQL recovery behavior, not a pg_dump/Supabase hosted restore.

## Independent full backup (owner-operated)

Use the official Supabase CLI/pg_dump workflow: https://supabase.com/docs/guides/platform/backups and https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore.

1. Use a trusted owner machine with Supabase CLI and PostgreSQL tools. Obtain the connection configuration from the project dashboard; never paste passwords into Git or chat. Keep connection credentials in a protected pgpass/service file or a secret manager.
2. Export roles, schema, and data using the current official CLI guide. Include the private schema and approved-user provisioning. Retain versioned SQL migrations separately. Check which managed Auth objects the provider supports restoring; do not blindly replace managed roles/extensions.
3. Record migration version, export time, row counts per table, CLI/PostgreSQL versions and checksums in a manifest. Encrypt backup files using an owner-held key, then copy to user-selected off-site storage. A second copy in the same database is not independent.
4. Separately inventory Auth settings, redirects, allowed-user identity, environment-variable names and OAuth setup. Back up encryption keys separately from ciphertext. Do not put credential values in the manifest.
5. Set a manual weekly backup reminder while automatic off-site backup is unavailable. Choose retention and an isolated restore target before further production release. Free hosting alone cannot guarantee a zero-loss recovery point.

## Restore rehearsal

Use an isolated empty Supabase project within the Free project allowance or a trusted local Supabase stack. Never overwrite the live project to test recovery.

1. Follow the provider's current restore sequence, applying the correct schema/data/role handling. Restore the private allowlist and supported Auth state.
2. Compare all table counts/checksums and check foreign keys and uniqueness. Verify RLS is enabled on every private table and forbidden to unapproved users.
3. Sign in as the approved test owner. Refresh, sign out/in, edit/complete/restore a task, reopen a saved review, and confirm audit history. Test an unapproved identity and cross-user references.
4. Keep imports, provider writes and automation disabled. Reconnect/revoke integrations rather than assuming recovered tokens still work. Check for remote state changes before reconciling.
5. Record evidence and recovery time; securely remove the rehearsal instance and temporary exports when no longer required.

## Recoverable deletion

Tasks use deleted_at and remain in Planner → Recently deleted. Restore keeps identity and audit history. There is no automatic purge yet. Completed recurring occurrences must remain in history.

## Owner-operated account deletion (until secured UI workflow exists)

Pause integrations and revoke provider tokens first. Export only if requested. Use the Supabase administrative dashboard to delete the approved Auth user; application foreign keys cascade private data. Verify deletion and separately remove any provider resources only with explicit authorization. Explain retained independent backup copies and their retention; deleting live records does not erase old backups automatically. This procedure is not currently browser-tested against hosted Supabase.

## Tested offline user-export rehearsal

Run `node scripts/verify-user-export.mjs /path/to/life-os-export.json` on a trusted machine with development dependencies installed. The command reads the export into an in-memory PGlite PostgreSQL instance, applies the versioned migrations, recreates synthetic Auth stubs solely to exercise ownership, restores rows in foreign-key order, preserves versions/timestamps/audit history, compares all exported values, and checks owner/cross-user/anonymous access. It never connects to the hosted database, logs source record contents, or stores a recovered database on disk. Keep the input export private and out of Git.

The supplied 2026-11-06 export successfully restored all 20 records across 44 tables, with content equality, database constraints, owner access, cross-user isolation and anonymous denial verified. The uploaded export itself is not part of the repository.

This is **user-data recovery**, not real Supabase Auth or full-project disaster recovery. Missing tables, incompatible schema, mixed owners, broken references or server-only credential references cause failure rather than silently losing data. An active integration requires separate credential recovery/reconnection. Independent provider-supported full backup/restore remains a launch prerequisite.

## Life OS 2.0 completion history

User exports include `work_completions`, course/topic task links, actual block effort and linked study sessions. Restore these with their original ownership and foreign-key relationships; never recompute actual effort from planned calendar duration. The additive completion migration is tested locally and requires release review before production application. These tests do not restore production Auth, encryption keys, OAuth grants or Google resources.
