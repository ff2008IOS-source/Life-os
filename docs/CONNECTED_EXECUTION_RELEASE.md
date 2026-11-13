# Connected execution: release evidence

Branch: `feature/trustworthy-connected-workflows`. Target: reviewed preview in the existing `lifeos` project. Production application promotion is not part of this increment.

## Implemented

1. **Truthful results:** overall grades require explicit inventory and grading-rule confirmation plus verified/user-confirmed assessment sources; unknown scores remain unknown. Worker summaries recognize returned failures and held/conflicting writes. Explicit example metadata is excluded from Home, Briefing and Insights. Polling copy no longer guarantees hourly refresh across a queued table backlog.
2. **Academic preparation:** Academics → assessment → Prepare work captures an explicit estimate and scheduling choice. An owner-scoped transactional RPC reuses the existing task on retry, keeps the course/deadline relationship and rejects unavailable/submitted/dropped assessments. Existing task editing, scheduling preview, reservations and atomic work completion are reused. Completing preparation does not submit an assessment or establish mastery.
3. **Source-connected domain pages:** Career and Projects expose the same mapped records and guarded editor used by Sheets settings. Project bindings require owner-selected records and explicit four-state mappings with aligned current status. Normal project edits use the existing transactional outbox; incoming status changes update the same project. Source missing/conflict states remain visible. Earlier career imports remain an archive. This is not automatic conversion of every Sheet row into every domain table.
4. **Review accountability:** approved task commitments reuse `review_items`, carry unfinished tasks forward once and use current canonical task status. The conversation receives bounded approved-commitment context. Each review retains a first-prepared factual snapshot; later source edits do not rewrite it. Snapshots and commitments are included in user exports and isolated restoration tests. Review completion requires owner-reviewed reflection; conversation does not create commitments automatically. Scheduled preparation remains a snapshot, not a completed owner review.
5. **Interface consolidation:** legacy import tools are folded separately from current Sheets synchronization; duplicate connection cards are removed. Home alternatives use the same ranking as the primary recommendation. Attention precedes check-in on the phone Briefing; weekly detail is expandable. Search accurately states its scope, shows a no-results state and deep-links projects/goals. Optional unconfigured finance/wellbeing areas are labelled accordingly. Mastery edited by hand is labelled self-assessment.
6. **Recovery and release checks:** isolated PostgreSQL recovery now includes review snapshots and commitments. Encrypted backup-only runs can retain encrypted credential rows; hosted restoration of OAuth/Canvas credentials stays blocked until encryption-key recovery and worker isolation are rehearsed. The recovery guard now checks Canvas credentials as well as OAuth credentials.

## Verification

- TypeScript, ESLint and repository formatting passed during development; final checks are recorded with the PR.
- Full automated run: **269 tests across 56 files passed**. Includes actual scheduling logic and PostgreSQL transactions, ownership, retry/idempotency, unchanged submission/mastery, review commitment status and immutable snapshot permissions.
- The project round-trip test runs the actual synchronization service against PostgreSQL and a **synthetic Sheets REST provider**: ordinary project update → draft approval → confirmed provider write → incoming edit → same project, without echo or duplication; formula preserved.
- Production build and traced PDF-parser bundle check passed.
- Browser tests exercise a local production build with synthetic Supabase protocol/provider fixtures. They do not prove live Google or hosted Auth behavior. The first full run identified three outdated/regressed paths; they were corrected before the final rerun.
- Dependency audit reported **zero vulnerabilities** for production dependencies.

## Shared database migration

`20261113091245_connected_execution_integrity.sql` was applied to the existing shared Supabase project after isolated migration tests. The filename matches the hosted migration history version. Changes are additive; legacy example records receive explicit metadata, without deletion.

Read-back checks confirmed:

- Counts preserved: 3 tasks, 89 assessments, 7 projects, 10 goals.
- All three legacy test tasks are explicitly excluded from real recommendations.
- No course completeness or grading confirmation was invented.
- Snapshot RLS enabled with two owner policies; anonymous preparation execution denied; authenticated snapshot updates denied.
- Zero writable personal calendars.
- Notification-preference fingerprint unchanged. No MFA/profile-picture activation or shooting-chart changes.
- Security-advisor categories/counts unchanged from before migration. Existing intentional server-only tables lack client policies; existing privileged RPCs require their authorization checks. The provider's leaked-password-protection advisory remains; no paid option was activated. References: [Supabase RLS advisor](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [privileged RPC advisor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Not verified / remaining dependencies

- **Full hosted disaster recovery is not complete.** Only the production Supabase project was available. An empty isolated Free recovery target, owner-configured database credentials/backup passphrase, encryption-key inventory and verified disabled-worker restoration are still required. Never use production as the rehearsal target. See [hosted recovery instructions](HOSTED_RECOVERY_SETUP.md).
- No real calendar reservation, new source-sheet edit or live Groq evaluation was performed by this increment. No production academic tasks or completion records were manufactured to satisfy a test.
- Real Sheet-to-project bindings require the owner to choose matching records and valid source status values. Existing production bindings were not guessed or enabled automatically. General contacts, goals and skills remain mapped source records unless a supported domain relationship is explicitly configured.
- Sheets retains the documented preflight/write concurrency race. Stable keys based on editable semantic values still require reviewed relinking on identity changes.
- Historical snapshots start when a review is prepared; they do not reconstruct past provider states. AI input remains bounded and is not a complete audit of every record.
- Full-workspace query refactoring and advanced evidence-based mastery evaluation remain outside this increment. All 30 original audit findings are not claimed resolved.
- Responsive automated tests are not physical iPhone/iPad verification. The signed-in hosted owner journey needs separate live verification.

## Recovery / rollback

The application can roll back to the previous production build without dropping these additive columns/tables. Preserve snapshots, commitments, audit history and task links. Prefer forward repair for database problems; do not drop tables or restore into production to undo a UI release. Provider settings and automatic-outbound permissions were not broadened by this release.
