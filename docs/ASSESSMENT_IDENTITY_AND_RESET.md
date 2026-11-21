# Assessment identity and a fresh workspace

Owner requested one assessment per real obligation and a clean activity reset on 2026-11-16 UTC. Owner explicitly chose rebuilding source-backed projects/tasks when Sync all is used after reset.

## Identity

A shared read projection groups a course's numbered exam summary with its unique multiple-choice and short-answer components. It also matches cross-source numbered assignments (for example ZAPS 1 and ZAPS 1: Split Brain), equivalent normalized names and parenthetical instructions. Different courses, exam numbers, same-source ambiguities and duplicate components stay separate. Original source rows remain intact; applying this projection repeatedly is idempotent.

PSYC Exam 2's actual Canvas components are 64/80 and 21/45. The display combines these as 85/125 points (68%) with the individual results available in the exam details. Course grading still follows verified syllabus rules. Conflicting summary/component percentages are retained and block a calculated standing. Missing components are not converted into zero. Makeup alternatives appear within the exam details, not as extra required exams.

The same projection feeds Academics, dashboard academic summaries, briefing and new review snapshots, and review/academic AI context. Canvas work explicitly marked graded belongs in history; missing electronic-upload timestamps do not make an in-person exam outstanding. Explicit missing/conflicting source statuses remain distinct.

## Reset

Settings → Privacy & account → Review activity reset shows a fresh fingerprint and counts before requiring CLEAR MY ACTIVITY. The owner-scoped transaction clears tasks, projects, reviews, review conversations, check-ins, work/study sessions, planning histories, old updates and execution links. Project-linked milestones are cleared with their projects. Goals, course records, source grades, topics/materials, calendars, source ledgers, integration permissions, dashboard preferences and operational quota/security audit records are preserved. Planning and automated review generation are paused.

A private, inaccessible-to-client recovery snapshot retains the cleared local records and old assessment-task links. External spreadsheet cells and calendar events are never deleted by this operation. Active future calendar reservations must first be resolved. A changed preview is rejected; replaying a completed request does not clear newly created activity. Tables retain their FK/RLS/audit enforcement throughout.

The existing registered-session rule (`20261106070701_session_and_mfa_security.sql`) requires the owner's live Auth session for this operation. Administrative SQL without that session was rejected. Do not weaken this rule, manufacture a session, or claim live history has been erased without a successful signed-in reset.

## Sync all

Settings → Connections → Connected data → Sync all orchestrates Canvas, selected Google calendars and active Sheets tables. Paused/test workbooks are skipped. Partial failures, queued Canvas resources and unconfirmed requests remain visible; incoming refresh does not approve new outgoing changes.

After an opted-in reset, freshly synced source rows with explicit Project / Task / Next Action fields can rebuild execution records. Stable dataset/row links prevent duplicates across repeated runs and row reordering. Current-semester unfinished actions become inbox tasks without fabricated deadlines or completion timestamps. Future-semester plans, completed source actions and stale dated exam preparation remain in the source plan. Not-started projects use a genuine planned status. Local edits win over a later source change and are reported for review. Manual activity and old reviews are never reconstructed from source reflections.

## Evidence and limits

310 unit/database tests cover, including real PostgreSQL-engine reset, replay, stale preview, cross-owner, source rebuild and local-override cases. Browser verification covers the complete consumer flow and existing regressions. See the PR checks for final browser/release status. The provider calls in browser tests are synthetic; they do not prove a real owner's OAuth refresh or Google writes. The owner must execute the reset from their signed-in session.
