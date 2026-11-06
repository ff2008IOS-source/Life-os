# Development progress

Last updated: 2026-11-06. This is a local Stage A milestone, not a completed release.

## Phase 0 — completed initial feasibility review

- [x] Official-source free-tier and OAuth constraints documented
- [x] $0 architecture and explicit limitations documented
- [x] Security, integration gates and recovery approach documented
- [x] Local runtime checked (Node 24; Docker daemon unavailable)
- [ ] Hosted project quotas, Auth settings and deployment preflight verified

## Phase 1 — local foundation implemented

- [x] Next.js 16 App Router, React 19, strict TypeScript, Tailwind 4
- [x] Radix accessible dialogs and shadcn-style Button primitive
- [x] Responsive desktop sidebar/mobile navigation, dark/light/system themes
- [x] Supabase SSR authentication, approved-email + database allowlist, protected routes
- [x] Zod validation, exact-origin checks, safe errors, optimistic edits
- [x] Four SQL migrations, composite ownership constraints, RLS on all private tables
- [x] Unit, PostgreSQL and production-browser test infrastructure
- [ ] Hosted Supabase Auth/PostgREST verification
- [ ] MFA enrollment/challenge/recovery UI and hosted abuse-protection review

## Phase 2 — core workflows implemented locally

- [x] Home summaries/priorities and quick capture
- [x] Planner day/week/month/agenda task deadline views; inbox/status/area filters
- [x] Task create/edit/complete/reopen, recoverable delete/restore, atomic priority reorder
- [x] Task dependency links and cycle protection; multi-goal task links
- [x] Projects, goals, milestones, linked milestone-based and nonnumeric progress
- [x] Five Life Areas; no fabricated personal records; optional areas empty
- [x] Five-step weekly review drafts, completion and historical reopening
- [x] Basic recorded-data Insights; missing integration data stays missing
- [x] Search, persistent account preferences and paginated user JSON export
- [x] On-demand date-only recurring task generation and independent occurrence completion
- [x] Explicit synthetic example loader with duplicate protection
- [ ] Custom/academic-term Insights ranges and advanced goal/project history UI
- [ ] Drag/drop interactions, broader task hierarchy UI and occurrence-specific scheduling
- [ ] Recurrence background generation (intentionally off in beta A)

## Phase 3 — offline integration contracts only

- [x] Calendar event normalization, source IDs, exclusive all-day dates, recurrence metadata
- [x] Paged cursor collection, duplicate prevention and expired-token full-sync recovery tests
- [x] Read-only/write boundary assertion and authenticated credential encryption primitive
- [x] Explicit Sheets mappings, stable source keys and schema-change detection tests
- [x] Server-only credential schema and read-only integration-state grants
- [ ] Google OAuth routes, provisioning and live sync persistence/reconciliation
- [ ] Calendar selection/display and actual read-only provider verification
- [ ] Stage B authorization, verified mapping and actual imports

## Phase 4 — preview subset implemented

- [x] Pure deterministic scheduling heuristic and authenticated preview API
- [x] Approved initial work windows/caps, session/break/freeze constraints and dependencies
- [x] Explicit infeasibility warnings; no silent task drops
- [x] Editable preview limits and user-supplied synthetic busy intervals
- [x] Database schema for policies, work blocks, runs, decisions and leased jobs
- [ ] Persisted policies/runs and stale-preview revision checking
- [ ] Durable worker claim/retry/reconciliation implementation and verification
- [ ] Occurrence-specific work blocks, provider-backed availability, undo/apply
- [ ] Stage C approval, dedicated calendar creation, actual writes and idempotency tests

No background workers are configured. No schedule-apply route is exposed. Automation remains off.

## Phase 5 — normalized schema prepared; specialized workflows pending

- [x] Terms/courses/grading categories/assessments/topics/study sessions schema
- [x] Accounts/categories/fixed-precision transactions/budgets/savings schema
- [x] Optional habits/entries, contacts, sources/import batches and review items schema
- [x] Unknown academic grades stay NULL; category/course references enforced
- [x] Financial transfer integrity and exclusion from expense totals tested
- [ ] Specialized Academics/Career/Finance/Wellbeing CRUD interfaces and calculations
- [ ] Read-only career dashboard import and actual verified academic records (Stage B)

## Phase 6 — partial local verification

- [x] Unit/domain/scheduler/offline integration and PostgreSQL authorization tests
- [x] Independent local PostgreSQL snapshot restore checked for records, audits and RLS
- [x] Production browser flows using a test-only loopback Supabase adapter
- [x] Desktop and iPhone-sized navigation/modal checks
- [x] Automated accessibility scans including dark/light themes; not a full WCAG certification
- [x] Production build, type checking, lint and formatting checks
- [x] Production dependency audit: no known advisories at check time
- [x] Setup, feasibility, recovery and limitations documentation
- [ ] Actual iPhone/iPad Safari, manual screen reader and broader keyboard testing
- [ ] Hosted security review, rate-limit/MFA/recovery verification
- [ ] Independent pg_dump/Supabase restore rehearsal
- [ ] Measured performance targets, observability, PWA/push and notification delivery
- [ ] Verified Vercel private application deployment and Stage D activation

## Verification scope

The PostgreSQL tests use PGlite with mock Supabase Auth roles. Browser tests run the real Next.js production server against a test-only protocol adapter backed by PostgreSQL. This verifies local app workflows, not real GoTrue/PostgREST behavior or hosted recovery. The adapter is outside application source and is never used as a production authentication bypass. Synthetic test data is labeled [TEST].

## External prerequisites and current gates

The user is configuring secure environment settings. No credential values have been printed or committed. No hosted resources, personal integrations, real imports, Calendar writes or unattended jobs have been created. A Supabase Free project, provisioned approved test user, migrations and environment configuration are required for hosted verification; Vercel Hobby access is needed for deployment. Stages B, C and D each remain separately gated.

## Hosted follow-up — 2026-11-06

The user deployed the full source to https://lifeos-beta-ivory.vercel.app and reports successful login, refresh/sign-in persistence and task completion. Direct checks verified the login page and unauthenticated API rejection. Hosted schema metadata and a read-only unapproved-identity simulation confirm RLS coverage and isolation for the sampled core tables; see VALIDATION.md. This is partial hosted verification, not Stage D activation or proof of full backup recovery. The earlier deployment/credential prerequisites above describe the initial local milestone and are superseded by this follow-up where explicitly verified. Stages B/C/D remain closed.

## Export recovery follow-up — 2026-11-06

- [x] User confirmed export download and supplied the JSON file for verification.
- [x] Fresh offline user-export restoration passed for all 20 records/44 tables, including audit preservation and cross-user isolation.
- [x] Reusable offline verification script added; uploaded records remain outside Git.
- [ ] Provider-supported full hosted backup/Auth/secret restore remains pending; this does not open stages B/C/D.

## Manual hosted-recovery preparation — 2026-11-06

- [x] Manual-only encrypted backup/recovery tooling and iPad operator instructions prepared locally.
- [x] Live source fingerprint and FK-check SQL verified read-only; pinned CLI dump-script dry runs verified with synthetic connection details.
- [x] Security guards/encryption tests added, including rejecting production/shared-pooler confusion and corrupt archives/passwords.
- [ ] GitHub repository installation/access (currently no installed accounts; repository API returns 404).
- [ ] Owner disables public/anonymous signup and supplies database credentials only through GitHub Secrets.
- [ ] GitHub free-usage/billing stop confirmed; separate empty Free recovery project provided.
- [ ] Real encrypted backup, hosted restore and isolated browser login rehearsal run and verified.

The recovery setup does not change deployed application behavior. MFA/password recovery engineering and stages B/C/D remain pending.

## 2026-11-06 — Owner-authorized Stage B Calendar work

The owner explicitly deferred hosted backup/restore testing and authorized read-only Calendar, then career spreadsheet, then confirmed records/goals/projects. No Stage C/D or paid-service activation was authorized. The first live Calendar adapter, server-only encrypted token RPCs, OAuth/PKCE/state flow, explicit calendar selection, manual rolling-window sync, disconnect/revocation and cached Home/Planner agenda have been implemented locally. See GOOGLE_CALENDAR_SETUP.md for the exact limits. Verification/deployment evidence is recorded separately; a real Google consent/import is not claimed by code completion.

## Compact workspace and daily read-only refresh — in progress

Owner confirmed six Calendar connections/sync works, requested a cleaner, shorter interface throughout the app and explicitly requested automatic daily synchronization. Implementing a calendar-first bounded week/day grid, compact month and daily agenda, safe display-only grouping of matching entries, source filters, event details, small Home agenda, tabbed Settings, corrected horizontal checkbox rows, non-stretched Settings cards, shared spacing reductions and progressively expanded task lists. Daily read-only sync is separate from task scheduling automation and does not authorize Google event writes.

Official Vercel docs checked: Hobby supports once-daily cron, execution within the configured hour, no automatic failed-run retry; Fluid Functions support up to 300 seconds. A single daily invocation at 13:00 UTC is approximately 6–7 AM Vancouver under current timezone rules. Durable per-calendar/day job identities, optimistic claims, leases, bounded sequential work, owner authentication, secret-protected worker access, visible failures and per-connection opt-out are being implemented. Hosted scheduled execution is not yet verified.

The compact Calendar/Settings redesign is implemented and tested. The daily read-only worker completed a live authenticated refresh of all six selected calendars and recorded six successful jobs; unauthenticated access was rejected. The configured future cron trigger itself has not yet been observed. Calendar writes and automatic task scheduling remain off, recovery remains deferred, and career spreadsheet import is still pending.

## 2026-11-06 — Operational workspace additions

Implemented locally pending live owner consent and checks:
- Verified-header, read-only Google Sheet snapshots, ten-minute reviewed import jobs, source-change detection and atomic idempotent imports. Source goals/targets remain source records until deliberately promoted. Existing local imported rows are preserved, not overwritten by stale source content.
- Course/term/assessment/grading-category/topic/study-session forms. Unknown dates and scores remain null; category and assessment formulas must be configured before showing averages. Percentage-scale imports are labelled. Source submission status is separate from confirmed submission state. Contact follow-up CRUD does not message contacts.
- Calendar-backed scheduling previews, refresh when older than five minutes, fail-closed unknown availability, exclusive all-day boundaries, preserved existing reservations and effort accounting. Apply refreshes calendars again and rejects changed inputs or the freeze window.
- Explicit dedicated-calendar enrollment with `calendar.app.created`, stable event IDs, durable write intents, user-scoped mutation lease, and provider-confirmed work blocks. Existing calendars remain read-only. Undo uses exact provider etags and preserves external edits, near-term sessions and uncertain writes. Ambiguous calendar creation is never blindly retried. No unattended task scheduling enabled.
- Authenticator enrollment/challenge/removal, database-enforced verified-factor AAL2, registered-session checks, HttpOnly auth cookies, recovery-link flow, current-password confirmation, global signout after password changes, cancellable seven-day account deletion. Never run a real deletion as a test. Lost-authenticator recovery requires owner administration, not an MFA bypass in the app.
- In-app reminders, per-category preferences and Vancouver quiet hours, acknowledgement, optional Web Push device enrollment, generic lock-screen content, expired-device cleanup, capped durable delivery attempts and a notification-only 15-minute worker timer. No private-page service-worker caching. Push is best effort and requires a real device test.

Owner-dependent checks remain: Sheets API enablement and consent; import review/current-record confirmation; separate calendar consent and real apply/undo test; MFA enrollment and recovery email delivery test; Home Screen installation and push opt-in/test. Google External Testing refresh tokens may expire after seven days; production OAuth publishing/configuration must be reviewed for a lasting connection. Full hosted backup restoration remains deferred by the owner.

### Owner-authorized source transfer and activation

Read all nine mapped tabs through the connected read-only Google Drive provider and re-read them before transfer to confirm the values had not changed. The source spreadsheet was not modified. Applied two atomic, idempotent import jobs: 102 career/reference records and 70 academic records (one term, five courses, 31 assessments, 33 study topics). Seven source-reported percentage scores remain unverified; no submission, mastery, course grading formula or active task was inferred.

The owner explicitly selected “Activate only In Progress items.” Activated nine current-term goals and six portfolio projects, retaining source identities and source descriptions. Three future-term goals also marked In Progress remain reference-only. No completed/not-started items were activated and project automation remains off. A source basketball category without a matching native area remains unassigned rather than being silently recategorized. Source identities are retained through native edits and repeat promotion is blocked in the UI/database.

Verified owner RLS visibility of the imported rows. The signed notification timer has also recorded successful scheduled runs; its HTTP transport returns 200. Actual device push receipt and Google website consent for future Sheets refresh/dedicated-calendar writes still require the owner’s interaction.

## Project card cleanup and automatic scheduling

Owner requested shorter project summaries, no source links on cards, fixed card overflow and automation enabled. Card text now has bounded summaries, URL/audit-text filtering, wrapping and grid/flex shrink constraints; full source provenance remains in source records/IDs. Short descriptions are used for imported active project descriptions. Automation is an explicit persisted owner setting with a visible off control. The existing signed 15-minute worker checks estimated, eligible tasks against refreshed selected calendars and uses the same protected dedicated-calendar reservation path. Active imported projects participate when automation is enabled. Existing reservations remain fixed; test tasks are excluded; missing estimates do not generate invented work. Disabling automation is checked again before each provider write. Current owner has no active tasks with estimates, so enabled automation should report idle until real tasks are added.
