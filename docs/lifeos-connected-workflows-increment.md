# Connected workflows development increment — 2026-11-07

## Implemented in feature/canvas-sync

- Incorporates the existing PR #1 atomic work-completion implementation. A reserved nonrecurring session can record actual effort once, adjust its task, save linked academic study history, and appear in Insights and Weekly Review. Task completion requires an explicit choice. Practice does not award mastery. Existing external reservations remain preserved.
- Newly captured Canvas tasks retain the assessment's owned course. Previously captured tasks are preserved.
- Native Daily Missed Task Check and Weekly Career Debrief prepare durable, immutable snapshots from actual records. Submission evidence is distinct from grading. Daily checks target the upcoming Monday–Sunday week; weekly reviews use the scheduled week's dates. Optional schedules use Vancouver time, deterministic run identities, bounded queries and the existing signed worker. Nothing creates suggested tasks automatically or disables ChatGPT routines.
- A read-only server-side Groq assistant uses a fixed GPT-OSS 20B model, bounded context, structured responses, an allowlist of supplied source identities, persisted conversations and owner deletion/export. It is disabled by default and requires a Free-plan acknowledgment. Database-backed limits reserve up to 20 requests/day, 8,000 conservative tokens/request and enforce a 61-second interval. Failed/unknown calls retain reservations; there are no automatic provider retries or paid fallbacks. Conversation deletion does not reset allowances.
- Worker failures are isolated so an integration failure does not suppress unrelated workers. Native workflow notices reuse notification preferences and deduplication.

## Migration / release boundary

These four migrations have been exercised against an isolated synthetic PostgreSQL-compatible database, applied successfully to the shared hosted database after explicit owner approval on 2026-11-07:

1. `20261107073137_atomic_work_completion.sql`
2. `20261107073138_native_workflow_reviews.sql`
3. `20261107073140_private_assistant_history.sql`
4. `20261107073141_canvas_task_course_link.sql`

The hosted database serves both preview and production. The owner approved this shared-schema change; do not imply that a preview isolates database effects. Deploy this application increment only after the schema is approved and applied. Retain migration history; do not restore or roll back by dropping completion/history tables. Forward-fix defects and retain immutable records. The previous app can continue against the additive schema, but verify its ordinary study-session writes after the tighter completion-history policy.

No production application release, original spreadsheet changes, personal-calendar writes or paid services were activated by this increment. No real Groq request was made. Production Groq key configuration does not establish Preview configuration, account billing state or data-retention settings.

## Evidence and remaining verification

- TypeScript, lint, formatting, production build, 146 unit/database tests passed before the final course-link assertion; focused follow-up tests (13 Canvas database tests) verify that assertion.
- Three focused synthetic browser workflows passed, including responsive widths and accessibility checks. All 11 browser regression tests passed. The production dependency audit reported zero known vulnerabilities.
- Mocked Groq tests cover strict output, invented references, unsafe extra action fields, UTF-8 bounds, missing credentials and quota failures. These do not verify live Groq compatibility or teaching quality.
- Synthetic database tests cover native snapshot idempotency, cross-owner access restrictions, assistant activation, quota/rate enforcement and deletion without resetting usage.
- Canvas live audit found zero queued jobs, 145 page bodies and 91 file metadata records. Six page listings returned 404 and six file listings returned 403. Successful module-linked retrieval does not make those listing endpoints accessible. File metadata is not downloaded lecture/PDF content.
- Thirty Canvas mapping conflicts remain for owner review. Preserve existing notes and unverified historical grade records; do not resolve ambiguities merely to clear a counter.

## Agenda status

1. Canvas verification: live read-only audit performed; mapping review and production release outstanding.
2. Automatic Canvas refresh: existing resumable worker remains; production activation and live scheduled cadence verification outstanding.
3. Scheduling/completion: synthetic end-to-end cycle verified; real Google reservation/completion not verified.
4. Sheets: guarded two-way synchronization remains outstanding; original workbook is read-only.
5. Calendar: dedicated-calendar external-edit reconciliation remains outstanding; existing six calendars are read-only.
6. Native recurring reviews: implemented and tested synthetically; hosted schema applied; application preview verification pending.
7. AI: read-only assistant implemented/tested with mocks; live provider test, persistent question-by-question tutoring, mastery evidence, CBA and Excel courses remain outstanding.
8. Progress/insights: actual effort and academic history connected; broader project/milestone/goal propagation remains outstanding.

Next engineering slice: guarded two-way spreadsheet synchronization using a synthetic workbook, stable identities, field-level ownership, formula/protected-cell checks, durable outbox and explicit conflict resolution. Do not activate writes on the original career workbook.

Official provider references reviewed: https://console.groq.com/docs/models, https://console.groq.com/docs/structured-outputs, https://console.groq.com/docs/rate-limits, https://console.groq.com/docs/your-data and https://console.groq.com/docs/billing-faqs. Provider account limits and availability require live confirmation.
