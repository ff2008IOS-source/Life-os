# Google Sheets REST synchronization

## Scope and activation

Settings → Integrations → Google Sheets synchronization uses the generally available Sheets v4 REST API, encrypted existing Google OAuth credentials, the existing owner session/MFA/allowlist, and owner-only RLS. The preview-only MCP provider has been removed. Existing career imports and legacy project mappings remain read-only. The shooting chart is excluded.

Connect an explicit bounded table after inspecting worksheet metadata. Supply exact column headers, scalar types, one to four stable identity columns and field-level write permissions. Identities are hashed with their types; row locators are observations, never permanent identities. Missing/duplicate/ambiguous identity or changed headers stop the import. Records outside the selected range are not assumed deleted. Formula text, effective values and display values remain distinct. Error cells retain their error status.

New tables start import-only. Complete the disposable workbook verification, then explicitly authorize each production table and choose two-way/export-only mode. An optional separate toggle auto-approves future validated edits. Otherwise every outgoing insert/update/delete requires review and approval, then Sync now or a scheduled run. No existing production workbook is automatically opted in. Formula/protected/array-output/unsupported-validation cells cannot be written. The application never edits a formula or structure to make a mapping work.

An optional explicit project-status binding connects an imported literal status field to an existing owned Life OS project. Configure the four source status values and first align the current project/source values. Project status edits create durable outgoing operations in the same database transaction; source merges update the linked project without an echo. Other project fields, notes and tasks remain untouched. This is the first domain adapter; arbitrary academic grades/contact schemas are not inferred from unrelated columns.

## Reliability and concurrency

The ledger retains datasets, per-row baselines/local values/current source cells, content hashes, operations, sync runs and synthetic verification results. Incoming merges use three-way comparison per field. Conflicts present baseline/local/source values and explicit choices. A local choice resets the reviewed baseline but requires a new outgoing draft/approval. Missing source rows remain historical records.

The database provides atomic incoming batches and optimistic local edits. A durable dataset lease serializes local application synchronization and edits. Each job handles at most one outgoing operation, using a batch of at most 100 changed cells. All reads are bounded to 30,000 cells; UI pages contain 100 records with explicit continuation. Internal record reads page through the table instead of relying on Supabase's default row limit. New-record writes choose a verified blank row within the configured range; they do not append blindly. Deletion clears an approved literal mapped record only if it cannot damage unmapped data/formulas; it never deletes the local audit/history or shifts worksheet rows.

**Sheets REST has no atomic conditional compare-and-write.** Immediately before a write, Life OS re-reads identity, values, formulas, validations and protection, resolves the current row and checks the approved baseline. It then writes only the changed cells using RAW values and verifies a fresh read. Another actor can still change/reorder the sheet between the final read and write. Verification detects many such outcomes but cannot guarantee prevention or reconstruct every raced edit. Avoid simultaneous edits to the same mapped records during a sync; keep per-write approval enabled on important tables.

Timeouts/server errors/unverifiable write responses become unknown outcomes. Subsequent runs reconcile intended content before any new write. A nonconverged uncertain operation is held for review rather than repeated. Literal cell updates and stable-ID inserts can converge without duplicate creation. Creation of a synthetic workbook records its intent first; an unknown creation never automatically creates a second file. Failed verification is not marked successful.

## Scheduling and cost

Reuse the existing signed Supabase pg_cron → pg_net → Vercel worker invocation every 15 minutes. Each run selects one due table, not a second competing timer. Successful tables become due after one hour; multiple tables/failed jobs may delay this cadence. This is polling, not real time. Errors persist with bounded exponential retry delays; 429 honors Retry-After. Revoked/expired credentials require secure refresh/reconnection. The existing Vercel Hobby/Supabase Free architecture remains in use; no paid service or higher-frequency Vercel cron was added.

Official references: https://developers.google.com/workspace/sheets/api/limits and https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/batchUpdate . Read/write request quotas are 300/minute/project and 60/minute/user/project; provider quotas and free hosting resources can still throttle execution. Job history and last success/error remain visible. No real-time or unlimited capacity claim is made.

## Verification and recovery

The test button creates a uniquely titled synthetic workbook with a formula, formatting and an unrelated-cell sentinel. Verification exercises this same server sync path: initial import, local/outbound update, external/inbound update, conflicting edits, conflict choice, addition, row reordering, reviewed deletion, preservation of formulas/formatting/unrelated values and repeat sync without duplicates. Only a fully successful run sets its status to verified. API/RLS denial, refresh, rate limits and unknown outcomes also have isolated automated tests; these do not prove live Google behavior.

The additive migration creates no imported records and enables no existing source. Owner exports include the new ledger/link/test tables; encrypted database backup/recovery enumeration includes them automatically. App rollback can leave these tables in place. Pause mapped sources and disable outbound writes before rollback; do not drop history/notes to roll back code. Production merges and real-table activation remain separate owner decisions.

## Sync all connected tables

Settings → Integrations → Google Sheets synchronization has a **Sync all** button above the account controls. It refreshes the current table list, then synchronizes active personal tables sequentially through the same authenticated endpoint as individual sync. Paused tables and disposable test workbooks are skipped. Existing table permissions, operation approvals, leases, formula protection and conflict checks still apply.

The results distinguish synced tables, changes needing review and failed attempts. One table's failure does not stop unrelated tables. Requests are not automatically retried after an uncertain response. Keep the page open while the batch runs; navigating away stops starting further tables, but a request already accepted by the server may finish. Each table's normal sync history remains available after reload.

A missing confirmed outbound timestamp means no outbound change has been verified; it does not prove that no write was attempted. The interface labels this explicitly.
