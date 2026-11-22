# Today reliability and capacity

Reference: production `4bbaae948b09e57aaf73a71e801d519f9299ac24`. Implementation starts from the equivalent local source snapshot and preserves remote-only documentation and later repository work. No personal records are reset, seeded, or deleted by this release.

## Existing-user changes

- Basketball Ops is retired. `/basketball` redirects to Planner. Navigation, command destinations, customization and the dedicated report code are removed. Sports-named personal projects, tasks, calendars and spreadsheet contents remain ordinary records. Learning remains available.
- Older layouts discard only the retired widget, including inside presets. Surviving order, sizes, pins, visibility and density are retained.
- The main destination is named Today. Sign-in has one concise form; authentication, recovery and ownership checks remain in place.
- Today separates planned work, deadlines, overdue work, dependencies and Inbox. A task appears once, with display precedence **waiting → planned → overdue → due → inbox**. Completion history is quiet and collapsible.
- The next fixed commitment, usable gap, source age and provider-refresh action appear above the task workspace. The inline active-session controls replace the floating timer on Today; the timer remains on other screens.

## Agreed calculations and dates

`today-plan.ts` is the selected-day domain model; `scheduler.ts` shares the work-block break intervals with it.

- Planned minutes are unfinished blocks allocated to the chosen local day, clipped to that day's boundaries. A deadline or an undated Inbox item does not allocate work. One task with two blocks appears once with the sum of its allocated minutes.
- Remaining task effort is `max(0, estimated − recorded actual)`. Missing estimates stay unknown. An open task at zero remaining receives “Estimate used up”, rather than fabricated completion.
- Completed blocks no longer create planned task rows. Their recorded effort consumes the daily capacity limit; older blocks without actual effort conservatively retain their recorded block duration for that limit.
- Available flexible time is the smaller of remaining daily allowance and unoccupied time in the allowed window. Busy commitments are unioned, so overlaps consume an interval once. Existing work blocks retain the saved inter-session breaks.
- The usable gap is uninterrupted. A future gap is labelled with its starting time and does not become a recommendation that can start now. A current allocated block, or an active/paused session, takes precedence appropriately.
- Capacity requires connected selected calendars, covered date ranges and successful refreshes within five minutes. Stale, disconnected and failed sources do not become confident free-time claims.
- The profile timezone defines local date boundaries. The selected date drives task groups, agenda, weekly context and upcoming assessments. Weeks run Monday–Sunday. Timestamped deadlines take precedence over coexisting legacy date fields; date-only deadlines retain local-day meaning.
- Date navigation persists in the URL. Browsing another day does not start a session in that day or reopen Sunday review access. Historical blocks and completions are displayed with an explicit reconstruction limit; current workspace records are not claimed as old snapshots.

## Confirmed writes and recovery

`WorkspaceProvider` merges the confirmed record/version before a verification read. A failed follow-up read produces **Saved · refresh pending**, retaining the saved row and an explicit recovery action. Revision/sequence checks and confirmed-version floors prevent older responses from erasing newer writes. Pending state is scoped for task capture, editing and completion. Confirmed focus finishes, work completions and block moves also retain their successful outcome if subsequent reads fail, with a read-only “Refresh saved work” action.

Creates use a stable UUID operation ID, sent as `Idempotency-Key` and used as the row ID. The owned duplicate path verifies the normalized input before replaying it. Unresolved operation IDs survive same-tab reload through a hashed session-storage key; task contents are not stored in that key. Lost responses reconcile against the same ID. A changed input is not silently substituted for an earlier operation. Existing optimistic version checks remain.

Entity-scoped change events replace ordinary whole-workspace reloads. Today reuses fresh server briefing/focus data; optional daily review data loads when opened. Optional academic and spreadsheet widgets load after the primary workspace, only when visible, so their sources cannot block the first task interaction. Calendar GETs share in-flight requests. Course-search failure leaves other search results available, while assessment and calendar failures remain contextual.

## Replanning, preparation and missed work

Calendar and Canvas normalization call the proposal generator independently of their confirmed import result. Generation uses a bounded task/dependency/source context, stable source keys and one active ledger decision per owned block. Repeated or concurrent source changes do not create duplicate proposals. Resolved/cancelled conflicts and work completed elsewhere retire obsolete pending decisions while preserving their original title/time snapshot.

Replacement proposals use saved scheduling rules, fixed commitments, dependencies, remaining daily allowance and official deadlines. The original block and deadline remain intact until a decision. Acceptance rechecks the current record and calendar availability, then reuses the existing calendar-write lock, provider preconditions and durable move intent. Retrying a confirmed move reuses the same decision ID. Freeze-window, no-capacity, unmanaged-block and stale-proposal cases require explicit review rather than silently moving a deadline.

Plan preparation creates or reuses the assessment's stable linked task. Remaining-minute input preserves recorded effort by saving `recorded actual + entered remaining` as the total estimate. A scoped preview shows sessions and unplaced work before applying them. An earlier personal target is retained; an earlier official deadline constrains planning without rewriting either source record. Completed sessions and fixed/manual blocks are not silently moved. A conflicting manually protected block receives a review decision with no automatic replacement. Applying the same completed reservation preview is replay-safe.

Missed decisions identify one block occurrence. Completed records actual minutes with `finish_task=false`; Drop affects only that block; Still planned records the decision without asserting task completion. The original occurrence's decision key stays resolved when revisited. Reviews expose unresolved decisions and paginated decision history, retaining the existing live Sunday gate. Recurring completion continues through the existing occurrence workflow rather than treating a template as completed. Unmanaged blocks and unsupported recurring scheduling require manual Planner actions.

Automatic freshness checks reuse the current integration ledger and leases, at most a bounded set of stale sources. They honor the existing automatic-sync opt-in. Manual “Refresh calendars” fetches provider data; “Reread saved status” only reads saved status. Neither fetches every integration aggressively.

## Migration and release prerequisites

Migration `20261122065309_active_work_block_decisions.sql` was applied to the existing production database on November 22, 2026, before the application rollout. It adds the partial unique index for active block decisions and explicit least-privilege **server-role** reads/writes used by the planning worker. It grants no new browser-role access, changes no ownership policies and rewrites no personal records. Existing records and source integrations survive migration. No dependencies or paid infrastructure are added.

An application rollback can leave the additive index and ledger history intact. No data reset is part of rollout or rollback.

## Verification scope

Use `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build`, `npm run test:bundle`, `npm run test:e2e` and `npm run test:requests`.

The browser harness uses loopback-only synthetic Auth/provider fixtures backed by real PostgreSQL (PGlite). These verify application behavior and SQL constraints/RLS, not full GoTrue/PostgREST compatibility. Mocked provider move tests are distinguished from normalized-record PostgreSQL checks and from real connected-account acceptance.

Screenshots and axe checks cover 390 px, 834 px and 1280 px Chromium views, including an active session and long task title. Keyboard tests exercise navigation, dialogs, command search and task editing. No physical iPad, native Safari or spoken screen-reader check is claimed. Real owner-authorized Google/Canvas end-to-end writes, live class-change acceptance and hosted recovery remain separate acceptance checks; production records are never modified to demonstrate them.

Final command results, measurements and release status are recorded with the delivery report. Request measurements count browser API calls, response bytes and local timings using the same synthetic fixture; they are not field Web Vitals or measurements of every internal database/provider operation.

The post-migration security-advisor results match the pre-migration baseline: eight informational notices for intentionally server-only tables, eleven existing authenticated security-definer RPC notices and the existing leaked-password-protection setting warning. This release adds no browser grants or new callable SQL functions. See [the function-permission advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) and [password protection settings](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) for that pre-existing configuration.

## Synthetic request measurements

Sequential local runs used the same measurement script and empty-account fixture: production-equivalent baseline `67ed0fd` and this implementation. Counts are browser API calls and uncompressed response-body bytes; server-rendered payloads, provider calls and internal SQL query counts are outside this measurement. The old build already supplied the briefing/focus data on the server: the new code reuses it instead of fetching duplicate copies on mount.

| Workflow      | API calls before → after | Response bytes before → after | Observed UI timing before → after |
| ------------- | ------------------------ | ----------------------------- | --------------------------------- |
| Open Today    | 5 → 2                    | 2,285 → 111                   | 389 → 389 ms rendered             |
| Capture task  | 3 → 3                    | 6,607 → 4,245                 | 217 → 217 ms confirmed            |
| Complete task | 3 → 3                    | 6,332 → 3,970                 | 172 → 158 ms confirmed            |

Opening removes three redundant client API reads. Task creates and completions retain three requests, but the full workspace read becomes a single-record verification read. This is a reduction in unnecessary read scope, not a claimed reduction in their request count. A single local sample does not establish a latency improvement: completion quiescence was 779 → 865 ms, while opening quiescence was 1,102 → 1,036 ms. The raw [before](verification/today-requests-before.json) and [after](verification/today-requests-after.json) files include the full measured breakdown.
