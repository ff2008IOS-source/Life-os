# SFU Canvas integration — implementation and verification checklist

Development branch: `feature/canvas-sync`, draft PR #2. Production promotion requires owner approval. Canvas is read-only: every provider request uses GET against `https://canvas.sfu.ca/api/v1/`, rejects redirects and untrusted pagination origins, and has bounded timeouts/retries.

## Implemented

- [x] Server-protected `/canvas-connect`, existing allowlist, registered sessions and enrolled-user MFA. Preview origin validation uses Vercel's deployment hostname, never the request Host header. Production origin checks remain explicit.
- [x] Password-masked token entry and actual expiration time in Vancouver. Expiration is owner supplied, not independently certified by Canvas.
- [x] Validate the token with `/users/self/profile` before storing it. AES-256-GCM uses a random IV and owner ID as authenticated additional data. Stored tokens/ciphertext are never returned through application APIs or included in user exports.
- [x] Persisted validation-attempt throttling, safe replacement, pause/resume, removal, expiration handling and source freshness/status. Replacement clears authorization backoff while preserving imported records and partial-page cursors. A different Canvas student account is rejected to prevent mixing grades.
- [x] Expiry warnings at the 7/3/1-day thresholds and expiry, using the existing deduplicated notification preference/quiet-hour system. Removing a token preserves records and the private account binding; a different account requires a separate deliberate reconciliation.
- [x] Durable owner-scoped resource jobs, pagination cursors, seen-page protection, leases and token generations. A provider page, grade history, native reconciliation, child jobs and cursor commit in one PostgreSQL transaction. Failed pages keep their cursor and retry state; revoked authorization pauses sync. No missing source row silently deletes history.
- [x] Manual Sync now with resumable bounded batches. Repeated imports do not create duplicate native records or grade-history entries. Unchanged native fields do not generate repeated academic audit/version writes.
- [x] Read-only retrieval of courses/terms/syllabus/available totals, assignments and embedded own submissions, own submission comments/statuses, assignment groups/weights/rules, own enrollments, modules/items, published page contents, file metadata, announcements and course calendar events. Resource access failures are shown individually.
- [x] Stable course-scoped resource identifiers. Match existing courses by normalized code **and term**. Preserve course descriptions, manual grades, notes, topic mastery and study progress. Existing assessments/categories require review before Canvas fields are adopted. Shared fields detect local edits and missing provider values instead of silently overwriting them.
- [x] Conflict review compares Canvas and Life OS values. Confirmation is guarded by a source fingerprint and a transaction-time source check. Native adopted assessments have Canvas provenance; previous values remain in the academic audit trail.
- [x] Canvas deadline section in Planner, separate from Google commitments and Life OS work blocks. Add to Planner explicitly creates/reuses one linked task, with unknown effort and manual scheduling. Unchanged linked task deadlines can follow Canvas; user-changed deadlines are preserved. No calendar writes are activated by this integration.
- [x] `/canvas-materials` provides bounded, private course/resource browsing with timestamps, source status and selected grade/submission facts. Text is escaped; source HTML is not rendered as executable markup.
- [x] Server-side `canvasStudyContext` retrieves only a bounded subset of authorized text, including syllabus where available, marks content untrusted, includes source references/timestamps and explicitly reports partial coverage. It never retrieves or sends Canvas credentials to an AI provider.
- [x] User exports include Canvas records, mappings, jobs and grade snapshots. Credential/rate-limit tables are excluded. Offline restoration distinguishes base tables from the security-invoker deadline view.

## Scheduling and budget

Use the existing signed Supabase Cron → Life OS notification worker, verified active at `*/15 * * * *`. No additional scheduler, project, paid API or paid feature was created. The Canvas worker processes up to ten due pages per invocation and stops starting work after an 18-second loop budget; one in-flight bounded request may finish afterward. Manual requests process up to three pages. Leases expire after two minutes; page commits require the correct unexpired lease and token generation.

Jobs target 60 minutes for assignments, own submissions/enrollment grade totals, announcements and calendar events; six hours for modules/items/pages/file metadata and groups; daily for the course list. Critical resource jobs precede materials. These are targets, not delivery guarantees: initial imports, outages, permissions, request quotas or a large course may delay refresh. Each resource shows its own successful timestamp/error. A partial page never counts as a completed resource refresh. The connection's last successful resource sync is not proof that every course/resource is current.

Preview runs manual sync; the existing timer calls the production application, so new automatic Canvas execution is not live until the reviewed release is promoted. Core tasks, calendar and academics remain usable when Canvas fails. Background failures must not disable existing notification/scheduling work.

Current official documentation checked on 2026-11-07:

- [Canvas pagination](https://canvas.instructure.com/doc/api/file.pagination.html), [throttling](https://canvas.instructure.com/doc/api/file.throttling.html), [courses](https://canvas.instructure.com/doc/api/courses.html), [assignments](https://canvas.instructure.com/doc/api/assignments.html), [submissions](https://canvas.instructure.com/doc/api/submissions.html).
- [Vercel Schedules limits](https://vercel.com/docs/schedules/limits): current Hobby schedules allow a minimum 15-minute interval and have a monthly run allowance. This integration does not create Vercel Schedules; it reuses the existing Supabase timer.
- [Vercel function limits](https://vercel.com/docs/functions/limitations): current Hobby Fluid Compute maximum is 300 seconds. Canvas manual routes use a smaller 60-second limit and durable checkpoints.
- [Supabase Cron](https://supabase.com/docs/guides/cron). No free-tier quota is treated as unlimited.

## Deliberate boundaries

- File metadata is synchronized, **not downloaded PDF/PPT contents**. Canvas pages/syllabus text can be retrieved; inaccessible materials are not claimed to be available. A Canvas file entry is not evidence of full lecture or exam coverage.
- Published-page bodies are separate jobs. A module item/link alone does not establish that its underlying document was retrieved.
- Individual score/status snapshots are retained; missing grades remain unknown. The app does not infer assignment weights, dropped outcomes, completion or mastery, or invent a weighted course total. Canvas-supplied group rules and totals remain inspectable source facts; they are not a newly verified native grading formula.
- No InQuizitive, publisher platform, Canvas quiz submission, assignment submission or university-record modification is implemented.
- No Groq tutor exists in this branch's actual baseline. The bounded source-context adapter is implemented; persistent tutoring, question grading, mastery and exam-coverage tracking still require the separate AI workstream. Connecting Canvas alone does not implement them.
- Real SFU API behavior, actual resource permissions, token validation/renewal and source reconciliation remain unverified until the owner enters a token securely. Mocked transport/UI tests are not live provider proof.

## Verification and release checklist

- [x] TypeScript, lint, unit/database tests and production build exercised locally.
- [x] Canvas client pagination, malformed responses, timeout/rate-limit behavior, trusted origin and retry controls covered with synthetic responses.
- [x] Credential encryption/ownership binding, connection replacement, write failures, validation throttling and source-account mismatch covered.
- [x] PostgreSQL tests cover idempotency, actual grade changes, notes preservation, local conflicts, partial rollback, stale-token rejection, paused retries, native planner linkage, MFA, anonymous/cross-user isolation and credential access denial.
- [x] Synthetic browser tests exercise the connection UI, password masking, replacement, status, sync flow, desktop/iPad/iPhone widths and automated accessibility. Browser Canvas responses are mocked; database tests exercise the real SQL separately.
- [x] Additive Canvas migrations applied to the existing shared project. Browser credentials/write grants are denied; all Canvas tables have RLS; the deadline view uses `security_invoker=true`. Existing five courses and 31 assessments were unchanged; no token or Canvas records existed at inspection.
- [ ] Final exact-commit preview readiness and protected-route checks.
- [ ] Owner login/MFA and token entry through the verified preview.
- [ ] Live SFU initial sync, source comparisons, resource permission reporting and repeat-sync checks.
- [ ] Owner approval to merge/promote production; post-release background refresh and real expiry reminder delivery verification.

The current production app is not replaced by these development changes. The Canvas schema additions are shared with the production database but do not import, delete or rewrite existing academic records by themselves. Recovery preserves source data and requires re-entering the Canvas token through the secured interface if the encryption key is unavailable. Hosted Auth/full disaster recovery is separate and remains unverified.

Final local evidence for this increment: 119 tests across 20 files passed, plus TypeScript, ESLint, Prettier and production build. Production dependency audit found zero advisories. All nine browser tests passed against the production build with synthetic auth/data and mocked Canvas UI responses. No physical device or real SFU token was used. The browser bundle scan found no server encryption/secret-key configuration references. Supabase advisors retain the pre-existing auth warnings and intentional service-only no-policy tables; no Canvas credential access was opened to browser roles. See [Supabase RLS linter guidance](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

The three source-controlled Canvas migrations match their provider-recorded versions: `20261107003637`, `20261107003914`, and `20261107004143`. They were generated with the CLI, tested in isolated PostgreSQL, then applied without creating Canvas records or changing existing academics. Keep `CANVAS_ENCRYPTION_KEY` stable during monthly personal-token replacement; changing that encryption key is a separate recovery/key-rotation operation.
