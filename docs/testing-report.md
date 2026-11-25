# Testing report

Run date: 2026-11-25, on the `claude/funny-mayer-j25zzj` branch before merge.

| Check                                                    | Result         |
| -------------------------------------------------------- | -------------- |
| `npx tsc --noEmit`                                       | Pass           |
| `npm run lint`                                           | Pass           |
| `npx prettier --check .`                                 | Pass           |
| `npm test` (vitest)                                      | **408 passed** |
| `npm run build`                                          | Pass           |
| `npm run test:e2e` (Playwright, PGlite fixture database) | **36 passed**  |

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

## Test data

All e2e records are synthetic and labelled `[TEST]` in an isolated fixture database. The owner's real data is only read, during production verification.

## Production verification

Recorded in [implementation-log.md](implementation-log.md) after deploy.
