# Testing report

Run date: 2026-11-26, on the `claude/funny-mayer-j25zzj` branch before merge.

| Check                                                    | Result         |
| -------------------------------------------------------- | -------------- |
| `npx tsc --noEmit`                                       | Pass           |
| `npm run lint`                                           | Pass           |
| `npx prettier --check .`                                 | Pass           |
| `npm test` (vitest)                                      | **418 passed** |
| `npm run build`                                          | Pass           |
| `npm run test:e2e` (Playwright, PGlite fixture database) | **37 passed**  |

## New tests this phase

- `tests/topic-finder.test.ts`:
  - title normalisation and dedupe;
  - the heading fallback;
  - the strict AI-reply schema;
  - assessment-to-topic matching by chapter;
  - the low-score, upcoming-exam, recent-session and stale-practice rules.
- `tests/wrap-up.test.ts`: what counts as done today, still open, overdue and auto-rescheduled; the card shows only after 5 PM.
- `tests/today-agenda.test.ts`: the last free window ends at 21:00 under the saved policy.
- `tests/e2e/y-topic-suggestions.spec.ts`:
  - suggested topics are listed separately and don't count;
  - Dismiss and Add work;
  - an approved topic starts as Not started;
  - "Find topics" on an unlinked course explains itself;
  - with the clock pinned to the evening, the wrap-up's Find time hands a task to the scheduler and Close out completes it.
- `tests/e2e/y-warm-workspaces.spec.ts`: `/basketball` redirects to Week.

## Career migration (2026-11-27)

- `tests/career-workbook.test.ts`:
  - school-year date inference;
  - target employers kept apart from applications;
  - text follow-ups kept as notes;
  - stable milestone keys across renames;
  - reviews and empty weeks;
  - Calendar Playbook kept whole;
  - Dashboard table boundaries and metrics;
  - Sheets column names past Z.
- `tests/e2e/y-career-migration.spec.ts` (iPad portrait):
  - dry run, import and re-import with no duplicates, keeping edits and Life OS reviews;
  - follow-up flags;
  - logging a conversation, checked after reload;
  - application deadline to Submitted;
  - portfolio edit and evidence in a fresh session;
  - opening an old review and saving a new review whose priority appears in next week's plan;
  - a missing School score staying unknown;
  - anonymous access refused.

  CI runs it again with `LIFE_OS_SHEETS_DISABLED=1`.

## Test data

All e2e records are synthetic and labelled `[TEST]` in an isolated fixture database. The owner's real data is only read, during production verification.

## Production verification

Recorded in [implementation-log.md](implementation-log.md) after deploy.
