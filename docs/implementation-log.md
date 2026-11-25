# Implementation log

Status keys: **Proposed**, **Planned**, **Implemented** (code merged), **Tested** (automated tests pass), **Production-verified** (checked on https://lifeos-beta-ivory.vercel.app with the owner's account).

## 2026-11-25: competitive research phase

| Change                                                                                                                                                    | Status              | Notes                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Today honours the saved 9 AM–9 PM scheduling window                                                                                                       | Implemented, Tested | It previously used `min(8, start)`–`max(22, end)`. Unit test added.                                                                                    |
| Remove the Basketball page; `/basketball` redirects to Week again                                                                                         | Implemented, Tested | Owner brief: no team management. Game-day buffers stay in the agenda.                                                                                  |
| `study_topics.suggestion_state` column                                                                                                                    | Implemented, Tested | Additive migration with a default of `active`; rollback is in the migration comments.                                                                  |
| Topic finder (`/api/v1/academics/topics`) with Groq and heading fallback                                                                                  | Implemented, Tested | Unit tests for parsing, dedupe and fallback. The e2e covers the approve/dismiss UI and an unlinked course. Live AI extraction is checked after deploy. |
| Evidence-based topic reasons and one-tap status proposals                                                                                                 | Implemented, Tested | Pure `topicSignal()` with unit tests                                                                                                                   |
| Evening wrap-up on Today                                                                                                                                  | Implemented, Tested | Unit test plus an e2e with the clock pinned to 6:30 PM                                                                                                 |
| Provider-neutral AI layer (`src/lib/ai/structured.ts`)                                                                                                    | Implemented         | Used by the topic finder                                                                                                                               |
| Research documents (`competitive-research`, `feature-comparison`, `free-integrations`, `product-roadmap`, `architecture`, `cost-audit`, `testing-report`) | Implemented         | Direct page fetches were blocked by the environment, so research is via search results and GitHub                                                      |

### Production verification (2026-11-25, after PR #43)

- `/basketball` redirects to `/planner` on the live site.
- **Find topics** on ECON 115 (live, the owner's account) read 6 files and suggested 29 topics, from midterm solutions and answer keys.
  - The Groq free limit was hit during the run; the remaining files used the heading fallback, as designed.
  - 9 files are left for the next press; 2 can't be read (scanned or too large).
- Existing ECON 115 topics show evidence lines ("Not reviewed in 18 days") with a one-tap "Mark needs review".

## Earlier this month (summary)

- Today redesign, "do this next", clashes (repeating-vs-repeating overlaps ignored).
- Syllabus-weighted grades, New term setup, "what you need" targets.
- School Overview · Grades · Materials; topics on every course.
- Type scale, hidden technical details, back links, Settings regrouped.
- Career follow-ups, the self-filling weekly recap.

All of these are production-verified (see earlier PRs #34–#41).
