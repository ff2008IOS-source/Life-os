# Retiring the Google Sheets career dashboard

Status as of 2026-11-27. The real workbook was imported into production on 2026-11-27 (PRs #68–#71).

## Can the workbook be archived today?

**Yes.** Every tab the owner maintains now lives in Life OS records. Today, Week, Growth, School, search and reminders read those records, not the sheet. The evidence:

| Requirement                                        | Evidence                                                                                                                                                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily workflows work with only Sheets switched off | CI runs `y-career-migration.spec.ts` a second time with `LIFE_OS_SHEETS_DISABLED=1`. The mirror and live import return 503; everything else passes. Google Calendar and Canvas aren't touched.                                                            |
| Old review → new review → its priority in planning | E2E: open the Aug 17 review; save Nov 9 with a priority; that task is due Nov 22 and shows on next week's Week view. Production: the imported Nov 23 picks are tasks due Nov 29 and show on Today and Week.                                               |
| Log a conversation, schedule a follow-up, reload   | E2E: a conversation with a follow-up on Nov 20 survives a reload, and its task is due Nov 20                                                                                                                                                              |
| Application deadline, then status change           | E2E: the deadline shows in follow-ups and Week; marking it Submitted completes its task and clears the reminder                                                                                                                                           |
| Assessment/topic update, missing score unknown     | E2E: the grade reads 80 with 1 of 2 scored, then 70 once the second mark is recorded. The missing score stays null.                                                                                                                                       |
| Edit persists into a fresh session                 | E2E: a portfolio edit and skill evidence are read back from a new browser context                                                                                                                                                                         |
| Re-import neither duplicates nor overwrites        | Production: a second run created 0 records, left 97 unchanged and rewrote 1 review (the bug fixed in #71, item 6 below). A third run after #71 is recorded under "Production re-run". E2E: Life OS edits and a Life OS-written review survive re-imports. |
| iPad width                                         | E2E at 1024×1366 with no sideways scroll. Production: Today, Career, Week and Reviews checked at 1024 px with no sideways scroll.                                                                                                                         |
| Account scope                                      | Every table has `own_records` row-level security. E2E: anonymous requests get 401 or 403.                                                                                                                                                                 |

The workbook was only read. Nothing in it was changed.

## What was written, deployed, migrated and tested

- **Written and deployed:**
  - native records (`career_entries` kinds, `contact_interactions`, review `details`);
  - Growth → Career workspace;
  - linked tasks;
  - review priorities;
  - the repeatable import (Settings → Connections → Career workbook);
  - the Sheets kill switch.
- **Migrated (production, 2026-11-27):**
  - 28 records created;
  - 69 Nov 6 snapshot rows adopted under stable keys, with no duplicates;
  - 1 review merged;
  - 3 linked tasks created from this week's picks.
- **Backup:** before the import, a copy was made of `career_entries`, `contacts`, `reviews`, `tasks` and `goals`. It sits in the private `backup` schema (`*_20261127`) and is not exposed through the API.
- **Tested:**
  - unit: 454 tests;
  - e2e: 42 tests, plus the career test again with Sheets off;
  - read-only production checks after import.

## Production re-run (after #71)

A third import on production found 98 records unchanged, 0 new and 0 updated. Read-only checks at 1024 px:

- Today shows this week's picks as the next action.
- Exactly one contact is flagged for follow-up: the one the workbook marks as pending.
- Week shows the picks.
- No screen scrolls sideways.

## Reconciliation by tab

New = created; Matched = already in Life OS (adopted or unchanged); To resolve = listed below.

| Tab                        | Owner maintains                                    | Decisions it supports             | Lives in Life OS                                                                                                          | New | Matched | Skipped                | To resolve |
| -------------------------- | -------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --- | ------- | ---------------------- | ---------- |
| Dashboard                  | Nothing directly (formulas), plus reference tables | What to do next; what is slipping | Today (Do this next, Due this week, Career), Week. North Star, KPIs, priorities and milestones are in Career → Reference. | 3   | 0       | 0                      | 0          |
| 4-Year Roadmap             | Year goals                                         | Long-term direction               | Career → Plans                                                                                                            | 0   | 4       | 0                      | 0          |
| Semester Plan              | Term goals, status, next action                    | What to push on this term         | Career → Plans                                                                                                            | 4   | 22      | 0                      | 4          |
| Weekly Review              | Win, risk, picks, progress                         | Next week's priorities            | Reviews (history and the Sunday review); picks become tasks                                                               | 13  | 1       | 8 (weeks not reviewed) | 0          |
| Network & Applications     | Contacts, target employers                         | Who to follow up; where to apply  | Career → People, Applications                                                                                             | 6   | 12      | 0                      | 0          |
| Skills & Portfolio         | Skill level and evidence, projects                 | What to build next                | Career → Skills & portfolio                                                                                               | 0   | 20      | 0                      | 1          |
| Calendar Playbook          | Rules for what goes on the calendar                | Calendar hygiene                  | Career → Reference                                                                                                        | 1   | 0       | 0                      | 0          |
| Course Command Centre      | Per-course next step and notes                     | Which course needs attention      | School (computed from course records); the notes are in Career → Reference                                                | 1   | 5       | 0                      | 1          |
| Assessments & Grades       | Scores and due dates                               | Grade standing                    | School (`assessments`, with Canvas kept independent)                                                                      | 0   | 31      | 0                      | 0          |
| Knowledge Mastery          | Topic mastery 1–5                                  | What to study                     | School topics (`study_topics`)                                                                                            | 0   | 33      | 0                      | 0          |
| Internship & Co-op Roadmap | Term-by-term co-op plan                            | Co-op timing                      | Career → Plans                                                                                                            | 0   | 11      | 0                      | 0          |

**Dashboard check:** recomputing the metrics from the priority table gives the same values the workbook shows (8 priorities, 1 complete, 7 in progress, 0 at risk, 13%).

**Dashboard formulas:** Next actions, Coming up, Check status and Career focus are formulas over other tabs. Life OS computes the same lists from its records:

- assessments due in the next 7 days, then this week's picks;
- past-due items that aren't marked complete stay "check status". A passed date alone never marks anything done.

The Calendar Playbook's guidance is kept whole in Reference.

## Unresolved records (owner decides; nothing was deleted)

The specific records (names, courses and marks) are in the owner's private report, not in this repository. By kind:

1. **A course whose Next Action is out of date.** The Course Command Centre's next assessment was newer than its Next Action text. School shows the next assessment from course records, and the old text is kept in Reference.
2. **Course averages that measure different things.** A workbook "Assessed avg" (weighted scored exams) disagrees with percentages in its note (Canvas's graded-work total, single exams), or predates a newer mark. Life OS computes each grade from its records and keeps both values.
3. **Four renamed Semester Plan milestones.** The Nov 6 snapshot rows are kept in Career → Plans for the owner to archive.
4. **One portfolio project** that is no longer in the workbook. It's kept in Skills & portfolio.
5. **Outdated goals in Growth → Goals** (outside this import), which Today still suggests. Pause or archive them there.
6. **One review overwritten.** During the re-run check, one Life OS review was overwritten by the workbook's (fixed in #71). It was a test placeholder, and the original is in the backup.

## Remaining dependencies

- **Google Sheets: none for daily use.** These remain, and both are optional:
  - **Settings → Connected plan details:** the earlier mirror of the sheet. If it fails, nothing else is blocked.
  - **The import itself:** read-only; it runs only when you press it.

  To turn Sheets off completely, set `LIFE_OS_SHEETS_DISABLED=1` in Vercel. Don't revoke the Google connection: Calendar uses it.

- **Google Calendar and Canvas:** unchanged.

## Daily updates (about 2 minutes)

1. Open **Today**.
   - Do the **Do this next** item, or press Done or Other.
   - **Career** shows who to check in with: press **Talked today**, or open People.
2. After a conversation: go to **Growth → Career → People**, press **Log**, write a line, and set the next follow-up date if there is one. A task appears on that date.
3. An application moved: **Applications → edit**, then change the Status. Submitted or later clears the deadline reminder.
4. A mark came back: **School** → the course → record the mark. The grade updates, and anything not yet scored stays unknown.
5. Skill progress: **Skills & portfolio → Add evidence**.

## Sunday review (about 20 minutes)

1. Open **Reviews**. Earlier weeks, including the workbook's history from Aug 17 on, are under the history.
2. Start the weekly conversation, write the win and risk, and confirm the summary.
3. Fill **Next week's priorities** (up to 3). Each becomes a task for next week and shows on Today and Week.
4. Look over Career → Plans and Applications for anything that changed status.
