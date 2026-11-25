# Feature comparison and prioritisation

Research date: 2026-11-25. Evidence is in [competitive-research.md](competitive-research.md).

**Scoring.** Each criterion is scored 0–10 and weighted:

| Criterion                      | Weight |
| ------------------------------ | ------ |
| User value                     | 30%    |
| Relevance to the owner's needs | 20%    |
| Reliability                    | 15%    |
| $0 compatibility               | 15%    |
| Feasibility                    | 10%    |
| Maintenance                    | 10%    |

These scores are informed estimates for ordering work, not measurements. Any idea that breaks the $0 budget, the security rules or a licence is disqualified whatever its score.

## Capability matrix

✓ = has it, ~ = partial, – = no, ? = unverified.

| Capability                      | Life OS (today)                | Motion           | Reclaim   | Sunsama    | Akiflow    | Shovel                  | NotebookLM    |
| ------------------------------- | ------------------------------ | ---------------- | --------- | ---------- | ---------- | ----------------------- | ------------- |
| Unified Today view              | ✓                              | ✓                | ~         | ✓          | ✓          | ~                       | –             |
| Deterministic auto-scheduling   | ✓ (scheduler, 4 h cap, freeze) | ✓ (AI/heuristic) | ✓         | – (manual) | – (manual) | ~                       | –             |
| Freeze/protect imminent work    | ✓ 60 min                       | ?                | ~         | –          | –          | –                       | –             |
| Buffers around key events       | ✓ games                        | ?                | ✓         | –          | –          | –                       | –             |
| Guided morning plan             | ~ Today screen                 | –                | –         | ✓          | ~          | –                       | –             |
| Evening shutdown                | ✓ (this phase)                 | –                | –         | ✓          | –          | –                       | –             |
| Weekly review                   | ✓ (self-filling recap)         | –                | ~         | ✓          | –          | –                       | –             |
| LMS (Canvas) sync               | ✓                              | –                | –         | –          | –          | ✓ Brightspace           | –             |
| Syllabus-weighted grades        | ✓                              | –                | –         | –          | –          | –                       | –             |
| Grade targets ("what you need") | ✓                              | –                | –         | –          | –          | –                       | –             |
| Study-time "enough time?" check | – (P1)                         | –                | –         | –          | –          | ✓                       | –             |
| Topics extracted from materials | ✓ (this phase, with approval)  | –                | –         | –          | –          | –                       | ✓ (sources)   |
| Spaced repetition               | – (P2)                         | –                | –         | –          | –          | –                       | –             |
| Career follow-ups               | ✓                              | –                | –         | –          | –          | –                       | –             |
| Price                           | **$0**                         | paid only        | free Lite | paid only  | paid only  | free + in-app purchases | free consumer |

## Scored proposals

| ID  | Proposal                                                | Inspired by                            | Value | Rel. | Rel'y | $0  | Feas. | Maint. | **Score** | Priority                       |
| --- | ------------------------------------------------------- | -------------------------------------- | ----- | ---- | ----- | --- | ----- | ------ | --------- | ------------------------------ |
| A   | Today honours the saved 9 AM–9 PM window                | own audit                              | 8     | 10   | 10    | 10  | 10    | 10     | **9.4**   | P0 (bug)                       |
| B   | Remove the team-management Basketball page              | owner brief                            | 6     | 10   | 10    | 10  | 10    | 10     | **8.8**   | P0                             |
| C   | Topics found in course materials, approved by the owner | NotebookLM, Secretariat-style planners | 9     | 10   | 7     | 9   | 7     | 7      | **8.5**   | P1                             |
| D   | Evidence-based topic status and "why" line              | Anki, RemNote                          | 8     | 9    | 8     | 10  | 8     | 8      | **8.5**   | P1                             |
| E   | Evening wrap-up (done / unfinished / hand to scheduler) | Sunsama                                | 8     | 9    | 9     | 10  | 9     | 9      | **8.9**   | P1                             |
| F   | "Enough time?" cushion per course and week              | Shovel                                 | 8     | 9    | 8     | 10  | 7     | 8      | **8.5**   | P1 (next)                      |
| G   | Visible reasons for scheduler moves                     | Motion, Reclaim                        | 7     | 8    | 8     | 10  | 7     | 8      | **7.9**   | P1 (next)                      |
| H   | FSRS review queue for topics                            | Anki, ts-fsrs (MIT)                    | 7     | 8    | 7     | 10  | 6     | 7      | **7.5**   | P2                             |
| I   | Gmail starred-mail intake                               | Akiflow                                | 6     | 6    | 6     | 8   | 5     | 5      | **6.1**   | P3 (needs new OAuth scope)     |
| J   | Separate automation platform                            | n8n, Activepieces                      | 3     | 4    | 6     | 3   | 5     | 3      | **3.9**   | Rejected                       |
| K   | Notes database                                          | Notion, Craft                          | 3     | 4    | 7     | 8   | 4     | 3      | **4.6**   | Rejected                       |
| L   | NotebookLM integration                                  | NotebookLM                             | –     | –    | –     | –   | –     | –      | –         | Rejected (no public query API) |

Score = 0.3·Value + 0.2·Relevance + 0.15·Reliability + 0.15·$0 + 0.1·Feasibility + 0.1·Maintenance.

## Accepted improvements

| ID  | Problem solved                                                            | Dependencies                         | Approach                                                                                                                                                   | Acceptance criteria                                                                                                               |
| --- | ------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| A   | Suggested work appeared at 8 AM and up to 10 PM, outside the saved window | scheduling policy                    | Pass `policy.start_hour`/`end_hour` to the agenda                                                                                                          | A unit test shows the last free window ends at 21:00                                                                              |
| B   | A team-management view the owner doesn't want                             | none                                 | Route back to Week; remove the nav entry, search entry and tile. Keep game-day buffers in scheduling.                                                      | `/basketball` redirects to `/planner` (e2e)                                                                                       |
| C   | Topics only came from a manually kept sheet                               | Canvas document text, Groq free tier | Server route reads extracted text and asks Groq for JSON topics, with a deterministic heading fallback. Results are stored as `suggested`.                 | Suggestions appear with their source file; Add, Dismiss and Add all work; no duplicates; mastery set by hand is never overwritten |
| D   | Status changed only by hand                                               | assessments, study sessions          | Pure rules: a low matched score means Needs review; a recent session means Practicing; a stale topic means Needs review; an exam within 14 days is flagged | Unit-tested rules; a one-line reason under each topic                                                                             |
| E   | No end-of-day close-out                                                   | tasks, scheduler                     | Today's evening card lists completed and unfinished work and offers "Let Life OS schedule it"                                                              | Shows after 5 PM; actions update tasks; e2e covered                                                                               |
