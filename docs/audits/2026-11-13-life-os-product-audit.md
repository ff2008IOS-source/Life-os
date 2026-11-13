# Life OS: software, interface and product audit

Audit date: 13 November 2026. Audit only: no production records, settings, spreadsheets or calendar events were changed.

## Verdict

Life OS has useful, working integration infrastructure. Its main weakness is the distance between connected information and a completed personal workflow. There are several representations of the same responsibility, several review experiences, and integration controls that are more complete than the domain screens they are supposed to power. The next investment should connect those pieces and make status claims precise before adding modules or visual decoration.

This report identifies 30 actionable findings. It is not a guarantee that every defect has been found. A missing capability is distinguished from a demonstrated defect, and an API limitation from an application bug.

## Evidence and limits

- Reviewed the current repository, source routes, domain services, migrations, integration workers and recovery procedures. Local HEAD was `2b31aee`; the latest released PR19 merge recorded in this session was `022fa337040e37211c0089913b4b990a71f36190`.
- Read live database aggregates: 89 assessments; 58 marked verified; 37 with neither a recorded due timestamp nor date; zero assessment-to-task links; three tasks, none real active tasks after excluding `[TEST]` examples; zero estimated or scheduling-eligible real tasks; zero work blocks, work completions or study sessions; 33 study topics. Unknown dates are not evidence of missed work or a broken provider.
- Eight real Sheets datasets were in two-way mode with successful recent reads and no recorded dataset errors. No Sheet-to-project links existed. Connection activation is not evidence of normal Career/Project screen synchronization.
- Inspected twelve routes at desktop, tablet and phone widths (1280, 834 and 390px) in the isolated local production-build fixture. No horizontal overflow was detected in these samples. Some early measurements captured loading states; those are not treated as completed-screen results or defects.
- Visually inspected tablet Settings and Reviews and phone Briefing screenshots. Fixture integration warnings reflect its intentionally absent live credentials; they are not production failures. Screenshots are synthetic, not the owner's signed-in records.
- Reproduced the grade-calculation issue with synthetic input using the actual TypeScript function. Observed an example task recommended by Briefing in the fixture.
- Existing release evidence records 257 automated tests and 21 browser workflows passing. These were not rerun for this read-only audit and do not establish all desired product behavior.
- No new live Sheets write, calendar reservation, Groq evaluation, physical-device test or full hosted disaster-recovery rehearsal was performed during this audit.

Priority definitions: **P1** affects trust, data integrity or the core execution loop; **P2** causes substantial friction or weakens reliability; **P3** is a lower-priority product improvement. Priorities do not imply a discovered production breach or data loss.

## Software and data integrity

### 1. P1 — Sheets sync is not the same as domain synchronization

**Confirmed architectural gap.** The new REST synchronization ledger and editor work separately from the legacy Career records. The Career page reads `career_entries` and explicitly says it is read-only. The new source tables are not a shared backing store for the ordinary Career UI or weekly-review context. There are no live Sheet-to-project links.

Evidence: `src/components/career-panel.tsx:150`, `src/app/api/v1/career/source/route.ts:19`, `src/lib/assistant/review-context.ts`, `src/lib/services/workspace.ts`.

Impact: a user can reasonably expect a normal project or career edit to reach Sheets when it does not. Earlier statements that all integrations were enabled should not be read as verification of this broader workflow.

Fix: define explicit source-to-domain mappings and field ownership; reconcile existing records instead of importing another copy. Acceptance: a disposable mapped project edited from its normal page reaches Sheets, a source edit returns, and the same project appears in review without duplication.

### 2. P1 — Assessment information has not become executable work

**Live workflow gap, not proof of a defective scheduler.** All 89 assessments lack task links, and no real active estimated/eligible tasks exist. Scheduling can be enabled while having nothing actionable to schedule.

Fix: put a short “Prepare for this assessment” workflow beside academic deadlines: link/create one task, capture an explicit estimate, preview feasible work, then record completion. Acceptance: one synthetic assessment completes that entire loop without duplicate entry.

### 3. P1 — “Overall course grade” can overstate completeness

**Reproduced correctness risk.** `academicGrade('points', [one scored assessment])` returns both graded average and overall grade, without a warning. Its input has no inventory-completeness or verification indicator. A partial assessment import can therefore look like a complete course result. This audit did not establish that a particular live course is currently displaying an incorrect grade.

Evidence: `src/lib/academic-grades.ts:1`, `:24`, `:53`; `src/components/academics-panel.tsx:201`.

Fix: require verified grading rules and explicit assessment-inventory coverage before calling a result “overall”; otherwise say “average of recorded scores.” Preserve the existing correct behavior that missing scores are not automatically zero. Acceptance: partial inventories and unverified weights never yield an authoritative overall grade.

### 4. P1 — Background-job summaries can conceal partial failure

**Confirmed return-shape defect.** The coordinator recognizes failure counts only inside arrays. A fulfilled object such as the scheduling worker's `{ failed: 1 }` is labelled `completed`. Conflict-held work can also be flattened into a success summary.

Evidence: `src/app/api/internal/notifications/route.ts:52`.

Fix: normalize all workers to one result schema with completed, partial, blocked and failed states. Acceptance: object failures, conflicts, quota delays and unknown outcomes remain visible without treating unrelated successful workers as failures.

### 5. P1 — Semantic keys do not survive source renames

**Identity design risk.** Sheets identity derives from configured key-field values. Keys such as names, project titles or organization names can be edited externally. Renaming them can produce a missing old identity and a new record, even though it is the same real entity.

Evidence: `src/lib/integrations/sheet-ledger-model.ts:154`, `src/lib/integrations/sheet-rest-snapshot.ts:223`.

Fix: use immutable source identifiers where authorized; otherwise provide an explicit reviewed identity-relink operation. Never add identifier columns to an important workbook without authorization. Acceptance: renaming and reordering preserve identity and history.

### 6. P1 — Sheets concurrent-write protection has a remaining race

**Provider limitation with material operational consequences.** Preflight rereads protect against already-observed changes, but a row can move or change between that read and the A1 write. Sheets does not provide the atomic compare-and-write guarantee this workflow would need. Post-write detection cannot always restore a concurrently overwritten value.

Evidence: `src/lib/integrations/sheet-rest-plan.ts:18`, `:39`, `:60`; outbound confirmation in `src/components/sheet-rest-panel.tsx:163`.

Fix: retain narrow writable fields, approvals for sensitive data, durable before/after evidence and clear uncertain-result recovery. Describe this residual risk honestly. Acceptance: race tests detect uncertainty and never report a fully verified conflict-free write merely because the provider accepted it.

### 7. P2 — Polling capacity does not match the hourly wording

**Confirmed scheduling-capacity mismatch.** The worker processes one due real table per invocation. At the existing fifteen-minute invocation interval, capacity is four tables per hour. Eight active tables require roughly two hours per round under ideal conditions, before retries or other delays.

Evidence: `src/lib/integrations/sheet-rest-server.ts:403`, `:411`; hourly wording in `src/components/sheet-rest-panel.tsx:524`.

Fix: use bounded batches within runtime/quota limits or display the actual cadence and backlog. Acceptance: eight due tables complete within the advertised refresh window, or the interface shows an honest later target.

### 8. P2 — Uncertain outbound operations lack a complete recovery interface

**UI/operations gap.** The settings panel exposes pending operation status and draft approval, but no equally clear reconcile, inspect-before/after or safely retire workflow for an unknown operation.

Evidence: `src/components/sheet-rest-panel.tsx:810`.

Fix: add a narrowly authorized recovery flow backed by provider rereads. Acceptance: a lost response can be resolved from the UI without blind retry or database intervention.

### 9. P2 — Full-workspace reloads make small edits unnecessarily expensive

**Confirmed query pattern; production latency not benchmarked.** Workspace loading pages eleven collections with `select('*')`; mutations reload the workspace. Briefing loads it again plus its own collections.

Evidence: `src/lib/services/workspace.ts:26`, `:40`; `src/components/workspace-provider.tsx:49`; `src/lib/briefing-server.ts:49`.

Fix: date-bound and select only necessary columns, use aggregates for counts, and invalidate affected views instead of everything. Acceptance: editing one task does not refetch unrelated historical collections.

### 10. P2 — Historical calendar volume can disable current Briefing availability

**Confirmed scaling boundary, not a current observed outage.** Briefing loads calendar history before filtering and rejects a collection above 2,000 rows. Sufficient old events can make today's availability unavailable.

Evidence: `src/lib/briefing-server.ts:22`, `:38`, `:125`.

Fix: query the relevant date window at the database/provider level while preserving all-day and overlapping events. Acceptance: a large historical archive does not change today's valid availability.

### 11. P2 — Example data can drive real recommendations and metrics

**Reproduced in the fixture.** Briefing recommended `[TEST] Preview a focused work session`. It filters unfinished tasks without a sample-record classification; Insights and area statistics likewise do not consistently separate examples. The live database currently contains only three example tasks.

Evidence: `src/lib/briefing.ts:156`, `:173`; `src/components/insights-page.tsx`.

Fix: use explicit test/example metadata and exclude it from real recommendations, outcomes and automation by default. Do not rely only on title prefixes. Acceptance: sample content remains available for onboarding but never distorts the real week's totals.

### 12. P2 — Errors are safe but often insufficiently actionable

**Confirmed interface limitation.** Generic database failures tell the owner to check setup; mapping/permission/concurrency problems can collapse into broad sync messages. This protects secrets but can leave the user unable to choose a remedy.

Evidence: `src/lib/http.ts:63`; `src/components/sheet-rest-panel.tsx:149`.

Fix: expose sanitized reason codes, affected integration and safe next action with a correlation identifier; retain detailed private diagnostics server-side. Acceptance: revoked consent, changed headers, quota delays and conflicts have distinct remedies.

### 13. P1 — Full hosted recovery is still unverified

**Documented assurance gap.** Export restoration and isolated PostgreSQL tests are useful, but do not establish recovery of hosted Auth, encryption keys, storage, provider connections and application configuration. The encrypted manual workflow is not proof that a complete rehearsal succeeded.

Evidence: `docs/RECOVERY.md:3`, `docs/HOSTED_RECOVERY_SETUP.md`, `.github/workflows/manual-recovery.yml`.

Fix: rehearse on an isolated approved target, record recovery time and data loss boundary, and verify secret/key restoration separately. Never test by overwriting production. Acceptance: an independent recovery instance passes sign-in, ownership, data and safe-disabled-integration checks.

## Interface and navigation

### 14. P2 — Settings contains competing spreadsheet products

**Source-confirmed and visually observed.** Career import, new REST sync, legacy mapped sync and another read-only career service card coexist. Users must understand implementation history to know which control applies.

Evidence: `src/components/settings-page.tsx:149`, `src/components/career-panel.tsx:150`; tablet Settings screenshot.

Fix: one connection summary, one table list and one history/conflict view; put legacy migration and advanced tools behind explicit secondary navigation.

### 15. P2 — Weekly Review remains several workflows stacked together

**Source-confirmed and visually observed.** Prepared context, conversation, reviewed-summary form, old written reviews, personal workflow snapshots and work-session history coexist. Each has a different entry/completion concept.

Evidence: `src/components/conversational-reviews-page.tsx:145`, `:163`, `:256`, `:261`.

Fix: one led review with factual opening, one question at a time, reviewed commitments and one clear completion action. Keep historical formats in an archive rather than the main flow.

### 16. P2 — “Search anything” searches only three entity types

**Confirmed functionality mismatch.** Search includes tasks, projects and goals, excluding assessments, course materials, contacts and reviews. Project/goal results route to collection pages rather than selecting the specific record. Nonempty searches with no matches lack a clear no-results state.

Evidence: `src/components/workspace-shell.tsx:157`, `:233`, `:267`, `:282`, `:299`.

Fix: accurately name current scope immediately; later add permission-aware academic/source search and deep links. Acceptance: the search never promises unavailable coverage and every result opens its entity.

### 17. P2 — Integration settings expose engineering concepts too early

**Source-confirmed.** Mapping JSON, row/column locators, operation payloads and technical run summaries are part of the owner UI. Some detail is useful for review, but it should not be necessary for ordinary usage.

Evidence: `src/components/sheet-rest-panel.tsx:576`, `:606`, `:819`, `:855`.

Fix: a guided mapping/repair flow with meaningful field names, source previews and an advanced diagnostics disclosure. Acceptance: common connection and conflict tasks need no JSON editing.

### 18. P2 — Phone Briefing is too long for its daily purpose

**Visually observed in the synthetic fixture.** At 390px the sample Briefing page was about 2,784px tall. Recommendation, check-in, alerts, insights and explanatory text compete; attention issues appear below the check-in.

Fix: prioritize next action and urgent issues, collapse nonurgent explanations and move detailed weekly analysis to review. Acceptance: the initial phone view communicates the primary decision and urgent issues without scanning several screens. Page height depends on real content; this measurement is not a production-user benchmark.

### 19. P2 — Daily guidance is duplicated between Home and Briefing

**Product/interface overlap.** Home already has next action, Top 3, deadlines, schedule and progress; Briefing repeats daily recommendation and overview. Users have two candidates for the command centre.

Evidence: route headings observed in local Home and Briefing; `src/components/briefing-page.tsx` and Home implementation.

Fix: make Home the daily decision surface and use Briefing for deeper context/check-in, or combine them. Avoid maintaining different ranking or freshness explanations for the same question.

### 20. P2 — Academic and career execution require too much navigation

**Information-architecture judgment.** Academic work is nested under Life Areas while preparation, tasks, scheduling and review are elsewhere. On mobile several important workflows depend on More or area navigation.

Evidence: `src/components/workspace-shell.tsx`; inspected academic, career, planner and review routes.

Fix: contextual actions from the actual assessment/project and a clear route back; prioritize frequent workflows rather than adding more top-level destinations.

### 21. P3 — Empty specialist areas imply more capability than exists

**Confirmed product gap.** Finance and wellbeing remain placeholder workspaces with future-phase copy. They add navigation breadth without helping current execution.

Evidence: `src/components/areas-page.tsx:234`, `:260`.

Fix: label them clearly as optional unconfigured areas or hide them until useful. Building finance now would compete with higher-value academic reliability work.

### 22. P2 — Important review facts are truncated without full coverage in context

**Confirmed limits; no specific missed live deadline demonstrated.** Prepared assessment display slices to sixteen; AI review inputs include only a few example items and truncated previous-review text. Brevity is necessary, but important omitted commitments need discoverability and deliberate prioritization.

Evidence: `src/components/prepared-weekly-review.tsx:88`; `src/lib/assistant/review-context.ts:139`, `:187`.

Fix: rank before truncation, show “N more”, and preserve structured commitments separately from narrative. Acceptance: the highest-risk deadline and every open approved commitment remain retrievable.

## Product logic and intelligence

### 23. P1 — There is no proven single responsibility-to-outcome journey

**Live evidence plus architectural assessment.** Task, assessment, imported career entry, source ledger row, project and review note can represent related work without a canonical relationship. Zero live recorded work/study sessions means the actual owner journey has not demonstrated the intended loop.

Fix: choose one synthetic academic journey and one project journey as release criteria, with stable identities and evidence visible across modules. Do not auto-create work just to make dashboards look populated.

### 24. P1 — “Mastered” is selectable without supporting performance evidence

**Confirmed model/UI gap.** An editor permits setting `mastered` directly and labels it “confirmed through practice” without requiring scored practice evidence. This may be a valid self-report, but it is not demonstrated mastery.

Evidence: `src/lib/academic-schemas.ts:74`; `src/components/academic-editor.tsx:148`.

Fix: distinguish self-assessment from demonstrated mastery; store practice outcomes and apply explicit evidence rules. Acceptance: a completed session or selected dropdown cannot silently become verified competence.

### 25. P2 — Scheduled career debrief and led review are separate products

**Confirmed behavior distinction.** The recurring workflow prepares a deterministic stored snapshot; the conversational review is started and persisted separately. Having both enabled does not mean a scheduled AI-led accountability review occurs.

Evidence: `src/lib/personal-workflows-server.ts:33`; `src/components/conversational-reviews-page.tsx:145`, `:261`.

Fix: scheduled preparation should open the same review record, with explicit ready, in-progress and owner-completed states. Preserve deterministic fallback; AI should lead reflection rather than certify facts.

### 26. P1 — Review commitments are narrative, not a durable accountability ledger

**Confirmed schema/context gap.** Priorities and missed commitments are text, carried into context in shortened form. There is no reliable structured distinction between a suggestion, an approved commitment, a completed outcome and a carried-forward decision.

Evidence: `src/lib/assistant/review-context.ts:187`; reviewed-summary controls in `src/components/conversational-reviews-page.tsx:163`.

Fix: link approved commitments to existing tasks/goals with date, status, evidence and review identity; avoid automatic task creation from ambiguous conversation. Acceptance: the next review checks every previous approved commitment exactly once.

### 27. P2 — Insights emphasize activity more than outcomes

**Product gap.** Counts of completed tasks and logged minutes are useful but do not establish exam readiness, skill improvement, completed career deliverables or goal advancement. Sparse historical data makes confident pattern claims especially inappropriate.

Evidence: `src/components/insights-page.tsx`; live zero work/study completion history.

Fix: retain defined activity metrics but add verified milestone/assessment/practice outcomes and explicit insufficient-data states. Never invent a productivity score to fill the space.

### 28. P2 — Historical review reconstruction uses current state

**Known limitation, partly disclosed.** Current overdue state and current records cannot reliably reconstruct what was known during an older review week. Existing labels help, but no complete versioned factual snapshot establishes historical truth.

Evidence: `src/lib/assistant/review-context.ts`; current-state labels in `src/components/prepared-weekly-review.tsx`.

Fix: persist minimal source-versioned factual snapshots when preparing/completing reviews and label later changes separately. Acceptance: an older review does not retroactively imply an assignment was known missing at that time.

### 29. P2 — Connection health is fragmented across the app

**Confirmed coverage gap.** Canvas, calendar, Sheets, automation and AI have different status surfaces. Briefing does not retrieve the new REST Sheets ledger/health, so a connected-source problem can remain confined to Settings.

Evidence: `src/lib/briefing-server.ts`; `src/components/settings-page.tsx`.

Fix: one small shared health contract with last successful read, pending writes, conflicts, failure reason and freshness; surface only actionable summaries on Home. Keep technical diagnostics in Settings.

### 30. P1 — Release confidence is broader than end-to-end evidence

**Assurance gap, not dismissal of existing tests.** Adapter tests, RLS tests, disposable Sheets checks and responsive fixture tests establish valuable components. They do not prove a normal Career edit reaches its source, an academic work session updates all appropriate views, a led review follows up approved commitments, or hosted disaster recovery works.

Fix: make the two canonical cross-module journeys release gates, with mocked failures plus separately recorded authorized live-provider checks. Report designed, implemented, tested, live-verified and deployed as separate states.

## Strengths to preserve

- Private authorization validates the Auth user, allowlist and registered session; mutation origin checks exist. This review did not establish an authentication bypass or credential exposure. It is not a full penetration test.
- Personal calendars remain read-only; writable reservations use the dedicated calendar and durable identities.
- Sheets has targeted writes, formula/protected-cell checks, three-way comparison, operation history and explicit API-race disclosure. Missing source rows preserve history rather than silently erasing local records.
- Missing academic grades are not automatically treated as zero. Source verification and submission state are separate concepts.
- Bounded query failures are surfaced rather than knowingly presenting partial totals as complete.
- Deterministic Briefing and prepared reviews can work without an AI provider. This is the right direction for the user's preference against a general chatbot.
- Automated testing and isolated data fixtures exist. Sampled layouts did not show horizontal overflow.
- Notifications, MFA and profile-picture activation remain owner choices, not defects to bypass. The shooting chart remains outside the current scope.

## Recommended execution order

1. **Repair truth and status claims first:** overall-grade gating, worker result normalization, sample-data isolation and honest sync cadence. These are small, high-value changes with deterministic acceptance tests.
2. **Complete one academic execution loop:** assessment to linked task, explicit estimate, schedule preview, authorized reservation, actual completion and review evidence. Confirm no duplicate data entry and no invented mastery.
3. **Bridge Sheets to actual domain screens:** reconcile existing projects/career entities with stable mappings and field ownership. Verify normal UI edits on disposable sources before extending live automation.
4. **Unify the led weekly review:** one record, prepared facts, short sequential conversation, approved structured commitments and next-week follow-up. Preserve archives.
5. **Simplify daily UI and Settings:** one daily command centre, compact connection health, meaningful deep links, advanced diagnostics secondary; hide empty optional modules.
6. **Close recovery and release assurance:** isolated hosted recovery and full cross-module acceptance evidence. Expand features only after these journeys are dependable.

Do not rebuild the app. Do not add a new general-purpose assistant, provider, vector database or paid service to solve these problems. The bottleneck is coherent domain behavior and trustworthy evidence, not model sophistication or branding.
