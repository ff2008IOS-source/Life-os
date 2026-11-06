# Local validation — 2026-11-06

This report covers the local Stage A milestone. No personal integrations or hosted resources were used.

| Check                  | Observed result                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `npm run typecheck`    | Passed                                                                                      |
| `npm run lint`         | Passed with no warnings in the final run                                                    |
| `npm run format:check` | Passed                                                                                      |
| `npm test`             | 36 tests passed across five files                                                           |
| `npm run build`        | Optimized Next.js production build passed                                                   |
| `npm run test:e2e`     | Four tests passed against production Next.js + test-only PostgreSQL-backed Supabase adapter |
| `npm audit --omit=dev` | Zero known advisories reported at check time                                                |

## What the tests establish

- PostgreSQL migration execution, per-user RLS, denial to unapproved/anonymous identities, cross-user and nested academic reference rejection.
- RLS enabled on every private application table; server-only credentials and provider state inaccessible for client writes.
- Optimistic version changes, stale-write rejection, soft deletion/recovery, append-only audit protection, circular dependency prevention, unique occurrences and idempotent test examples.
- An independent local engine snapshot restores into another PGlite instance with matching task/audit counts and ownership enforcement.
- Unknown grades remain NULL. Fixed-precision money is preserved and transfers are excluded from expense totals.
- Scheduler determinism, local work windows, session sizes, busy-event exclusion, breaks, existing daily workload cap, frozen-block preservation, dependencies, excluded areas, missing estimates, actual-time accounting, explicit infeasibility, historical DST and current Vancouver rules.
- Offline Calendar normalization, all-day dates, recurring source metadata, paging/deduplication, 410 sync-token recovery, protected-calendar write boundaries; explicit Sheets mapping/schema detection; tenant-bound authenticated token encryption.
- Browser sign-in through the synthetic test adapter, task capture and persistence after reload, completion/delete/restore, project/goal creation, recurring generation and individual completion, scheduling previews, review drafts/reopening/completion, export, sign-out and protected redirects.
- API origin rejection, stale-edit rejection, and preservation of a completed task's original completion timestamp during later edits.
- iPhone-sized navigation, no horizontal overflow on tested pages, modal Escape dismissal, automated WCAG A/AA scans on core screens and a task form, including dark and light themes.

## What is not established

- Real Supabase GoTrue/PostgREST compatibility/configuration, password recovery, MFA, hosted rate limits, or revoked-provider credential behavior.
- A complete Supabase/pg_dump/Auth/secret recovery rehearsal. PGlite snapshot recovery is narrower.
- Real Google OAuth, actual calendars/spreadsheet access, integration persistence, live provider reconciliation or any Calendar write.
- Durable workers, automatic retries, actual job execution, closed-app notifications or push delivery.
- Full WCAG 2.2 AA conformance, manual screen-reader coverage, actual Safari/iPhone/iPad behavior, or measured p75 performance targets.
- Vercel deployment, hosted reliability, billing/quota configuration, or approval for stages B/C/D.

No background job, Google write, personal import or paid service was activated. Finance and Wellbeing remain empty in the application; database financial tests use only isolated synthetic records.

## Hosted Stage A follow-up — 2026-11-06

User-reported manual verification:

- Approved account reaches Home on https://lifeos-beta-ivory.vercel.app.
- Test task remains after refresh and sign-out/sign-in.
- Completing the test task places it in Planner's Completed view.

Directly observed:

- `/login` serves the Life OS login screen; unauthenticated `/api/v1/tasks` returns HTTP 401.
- Hosted schema has 46 application/private tables, all with RLS enabled; 44 public ownership policies use the approved-user guard.
- Exactly one identity is in the private approved-user table (no user ID or email retrieved).
- No anonymous grants on application/private tables; no authenticated client grants on private tables or write grants on sampled server-only integration/audit tables.
- A read-only transaction acting as authenticated with a synthetic, unapproved UUID returned approval=false and zero visible tasks, projects, profiles and audit records. Transaction rolled back; no records changed.
- Security advisor reviewed. The authenticated-callable `is_approved_user` SECURITY DEFINER function is intentional: fixed empty search_path, no arguments, current auth.uid() only, boolean result, anonymous execution denied. Two private tables with no policies deliberately deny client access. Do not add permissive policies to silence these findings.
- Advisor reports leaked-password protection disabled. Supabase documents this feature as Pro and above; retain the Free plan and use a unique password. Source: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

This supplements, rather than replaces, the local test evidence. Hosted unauthorized-write tests, revocation/MFA/rate-limit checks, full backup/Auth/secret restoration, Safari/manual accessibility and performance measurement remain pending. No personal data imports, Google access, automation, paid service activation or schema changes were performed in this follow-up.

## Supplied user-export restoration — 2026-11-06

The user supplied a `life-os-user-export` version 1 file. It was restored into a fresh, isolated in-memory PostgreSQL engine: 44 exported tables, 20 records. Canonical values, audit history, record versions/timestamps, ownership foreign keys and CHECK constraints matched/passed. The restored owner could read their records; a different approved identity could read none of the restored records, and anonymous task access was denied. No live database changes or source record contents were logged. No uploaded records were copied into version control.

A reusable offline verifier and synthetic regression tests cover successful restoration, rejection of mixed owners, missing foreign-key targets and missing export tables. Real Supabase Auth is stubbed only inside this isolated test; full hosted recovery and secret/provider restoration remain unverified.

After adding export-recovery regression coverage: `npm run typecheck`, `npm run lint`, and all 40 unit/database tests across six files passed. No deployed application code changed in this follow-up.

## Manual hosted-recovery tooling validation — 2026-11-06

All 51 tests across seven files, strict type checking, lint and formatting checks passed after adding the manual recovery safety/encryption coverage. The pinned Supabase CLI 3.0.0 role/schema/data dry-run scripts were exercised with synthetic connection details. The live project's aggregate manifest and foreign-key verification SQL passed read-only checks. The GitHub workflow itself has not been installed/run, and a real SQL backup/hosted restoration/browser login rehearsal remains unverified. No live settings or data were changed.
