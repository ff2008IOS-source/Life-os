# Clear personal workspace

This increment addresses the owner's project, calendar, academic, material, Career and Insights screenshots. It preserves existing private single-user authentication and provider write approval flows.

## Changes

- Projects can be archived, recoverably deleted and restored. Removal stops new scheduling eligibility but leaves tasks, milestones, work reservations, source links and audit history in place. Restoration does not reactivate automation. Owner checks, CSRF checks and optimistic versions remain mandatory.
- Completed tasks live in a collapsible collection with no strike-through. An explicit Completed filter opens that collection. Flagged example tasks do not enter ordinary area or planner lists and counts.
- Optional dates have a visible date/empty summary and a Clear action, including academic date fields. Editing an existing record preserves its current hidden area or removed-project association unless the owner changes it.
- Calendar source controls are behind Calendars. Overlapping groups open a full readable daily schedule, while hidden sources still constrain scheduling/conflict checks. View and scroll preferences are versioned, bounded display-only local storage. New phone sessions default to Agenda. No provider records are altered by display grouping.
- Course assessments have search, status filters, due/submission/result columns, mobile cards and one assessment details view with preparation actions, notes and provenance. Results appear even when the grading formula is unknown. A current standing requires confirmed rules and score evidence; potential duplicates are flagged rather than merged. Missing results never become zeros.
- Grading details include linked course syllabus evidence from existing prepared text. This is reference material beside editable grading rules; there is no automatic interpretation of discretionary rules, grade transfer or cross-source identity merge.
- Materials are grouped by retrieved Canvas module membership where available; filename-based groups are explicitly suggested. Friendly names preserve original names in details. Search covers loaded course metadata (up to 999 records per response); larger libraries clearly show the limit and offer another page. File state is distinct from metadata availability. Existing background document processing and explicit preparation remain supported.
- Career shows active connected plan sections automatically. Source selection, guarded editing, approvals and reconciliation remain available in an optional details disclosure and Settings. Its read-only overview query avoids fetching operation and test histories for every section.
- Insights presents academic standing, concise weekly evidence, grouped practice topics and meaningful goal evidence. It hides repeated reflection placeholders and zero-valued statistic cards. Academic standing is a current snapshot, not a claimed week-over-week grade change.
- Finance and Wellbeing are hidden from ordinary navigation, area discovery and creation choices. Existing records remain stored and accessible through existing history/task flows.
- Academics and Career no longer repeat the generic area metrics and Overview/Tasks tab layer above their own domain controls.

## Database compatibility

`20261114013123_recoverable_projects.sql` adds only nullable `projects.deleted_at`. It was created with the Supabase CLI and aligned with the applied migration version. Existing rows, statuses, external identities, permissions, policies and triggers are unchanged. Hosted verification after applying it found seven projects, zero removed projects and project RLS still enabled. Removing or archiving a project never deletes a Google Sheet row or a Google Calendar event.

## Verification and limits

Automated verification uses synthetic accounts, a loopback Supabase protocol adapter backed by PostgreSQL (PGlite), and mocked external-provider responses. Database tests exercise owner RLS, optimistic versions, audit history and retained task/milestone links. Browser tests exercise deletion/restoration, date summaries, separated grade/submission information, potential duplicates, grouped materials, responsive widths and accessibility, as well as existing connected-work and sync workflows.

Live inspection verified the existing project schema/RLS and inspected the reported course's separate assessment and prepared syllabus records read-only. No production academic values were reconciled, no project was removed, and no workbook/calendar was written during this increment's verification. Owner-signed-in preview flows, live provider writes and physical iPad Safari remain separate acceptance checks.

The review preview is separate from production. Merge/release requires review. Notifications, MFA activation, profile changes and the basketball shooting chart are outside this increment.
