# Hosted security and full-recovery readiness — 2026-11-06

## Verified in this follow-up

- Connected Vercel project is Next.js; current production deployment reports READY.
- Production configuration contains the four required application variable names. Values were not decrypted or printed. The allowed-email variable is stored as sensitive.
- Connected Supabase organization reports Free plan. Vercel plan was not established by the metadata returned; do not infer it from deployment status.
- Real unauthenticated GET requests to tasks, workspace and export return 401 UNAUTHENTICATED.
- An unauthenticated same-origin task creation request returns 401 UNAUTHENTICATED.
- A foreign-origin task creation request returns 403 INVALID_ORIGIN.
- No records, hosting configuration, billing settings or database schema were changed by these tests.

## Actual issue requiring owner action

Supabase `/auth/v1/settings` reports `disable_signup=false`. The database allowlist still protects private records, but open account registration conflicts with the single-user application requirement. Owner should switch off **Allow new users to sign up** in Authentication → Sign In / Providers and save. Also confirm anonymous sign-ins are off. Existing user login should stay enabled. Recheck the settings endpoint after the owner changes it; do not mark the issue resolved from instructions alone.

Official setting documentation: https://supabase.com/docs/guides/auth/general-configuration

## Remaining security engineering

Hosted write authorization/ownership tests with controlled identities, revoked-session behavior, configured rate limits/abuse protection, MFA enrollment/challenge and password/account recovery need completion. App MFA/recovery user interfaces are not implemented. Do not equate Supabase dashboard administrator MFA with app-user MFA.

## Full hosted recovery route for an iPad-only owner

A command-line runner is required for the official Supabase CLI logical backup procedure. The current managed workspace lacks Docker daemon access and has no database connection credentials. Supabase MCP SQL access is not a complete backup downloader; never print password hashes, refresh tokens or credential tables into tool/chat output to emulate a backup.

Recommended candidate: a **manual-only** GitHub Actions workflow in the existing private repository, using a standard Linux runner, with billing stopped at the free allowance. GitHub Free documents 2,000 included minutes and 500 MB artifact storage; actual account usage/budget must be checked before enabling. No schedules, pushes or PR triggers. This is proposed, not configured or verified.

Proposed workflow sequence:

1. Owner creates/selects a separate empty Supabase Free recovery project, only after checking free-project availability and no upgrade/branch charges.
2. Owner supplies source/target database access using repository environment secrets, never chat or source files. Use TLS session-pooler/direct access without a paid IPv4 add-on. Keep target and source distinct and fail closed if target is not empty.
3. Run version-pinned CLI tools using the provider's current roles/schema/data dump and restore procedure, including supported Auth records and the private approved-user table. Confirm the backup's Auth coverage explicitly; a default schema dump alone is not full recovery. Capture settings inventory separately without publishing secret values.
4. Encrypt backup output before uploading an artifact. Keep the decryption secret separate, apply short artifact retention and obtain an independent owner-held copy. A short-lived CI artifact alone is not the retention policy.
5. Restore into the separate project; verify contents/relationships, policies and grants, actual login, ownership isolation, and test task/review workflows using an isolated preview. Production must keep its existing database/environment settings.
6. Document observed recovery time, retention and credential/provider reauthorization steps. Full recovery remains unverified until this succeeds.

Official backup procedure: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
Free-plan backup limitations: https://supabase.com/docs/guides/platform/backups
GitHub included usage and billing stops: https://docs.github.com/en/billing/reference/product-usage-included

No hosted backup workflow, recovery project, paid service, Google integration or unattended job was activated in this follow-up. Stages B/C/D remain closed. Offline user-export restoration is verified separately in VALIDATION.md and does not establish full Supabase/Auth recovery.

## Manual recovery tooling prepared — 2026-11-06

Implemented `.github/workflows/manual-recovery.yml` and `scripts/recovery/` with an operator guide in `docs/HOSTED_RECOVERY_SETUP.md`. This is a manual-only, private/default-branch workflow with an explicit zero-paid-spend confirmation gate. It pins official Actions commits, Supabase CLI 3.0.0 (locked dependencies) and a PostgreSQL 17 container digest. Source writes and live-target restores are prohibited; shared pooler project identity is checked via the username/reference, not hostname alone. Full TLS verification, nonempty-target refusal, before/after source fingerprints, encrypted artifacts, authenticated decryption, checked archive entries, FK validation after COPY, RLS/grant/content comparison and fresh restored-login requirements are implemented. Plaintext exists only in a private temporary runner directory and is removed in finally cleanup. Original Auth sessions are revoked only in a successful separate recovery target.

Verified locally: target guards, password separation, authenticated encryption round-trip/tamper/wrong-key behavior, owner-only file permissions, output overwrite prevention, manual/private/default-branch/zero-spend workflow gates, and detection of invalid foreign keys loaded with triggers bypassed. Actual pinned CLI dry runs for roles/schema/data were exercised with synthetic connection details; generated scripts contain no password assignment when executed and default data dump includes Auth records. Aggregate manifest and FK-check SQL executed successfully against the live project in read-only transactions; the manifest covers 72 application/private/Auth tables and found zero Storage objects, Vault secrets or MFA factors. No row contents or Auth credential values were printed.

Not verified: Docker execution on a GitHub runner, real database dump, encrypted artifact delivery, actual separate-project restoration or restored browser login. Repository access still returns 404 and GitHub installation discovery returns no accounts, so files have not been pushed and no Actions run is enabled/executed. Database credentials, billing-stop confirmation and an empty Free recovery target are still required. Public signup was rechecked and remains enabled. No production Auth setting, schema, record or Vercel configuration was changed.

## Public signup fix verified — 2026-11-06

After the owner changed Supabase's setting, a fresh request to `/auth/v1/settings` returned HTTP 200 with `disable_signup=true`. Public signup is now confirmed disabled; this supersedes the earlier open-signup finding. GitHub installation discovery still returns no accounts and the existing repository remains inaccessible (404), so installing/running the prepared recovery workflow is still blocked. No credentials or configuration were changed by the verification.
