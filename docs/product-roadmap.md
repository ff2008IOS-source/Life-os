# Product roadmap

Updated 2026-11-25. Priorities come from the scoring in [feature-comparison.md](feature-comparison.md).

## Principles

- Every component answers a real question: what to do, when, how it's going, what to decide, or where to find something.
- Deterministic logic for scheduling and grades; AI only where judgement helps (reading course materials, answering questions), always with a fallback.
- $0 to run ([cost-audit.md](cost-audit.md)). Life OS stays the single source of truth.

## P0: foundation and broken behaviour

| Item                                                                                          | Status                                                            |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Today's suggested work honours the saved 9 AM–9 PM window (it was using 8 AM–10 PM)           | **Done**                                                          |
| Remove the team-management Basketball page (owner brief); keep game-day buffers in scheduling | **Done**                                                          |
| Google OAuth consent screen in Testing mode makes tokens expire about every 7 days            | **Owner action:** publish "In production" in Google Cloud Console |

## P1: high value

| Item                                                                                                                                              | Inspired by                            | Status                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Topics found in Canvas files; owner approves; no duplicates                                                                                       | NotebookLM, Secretariat-style planners | **Done**                                                                                                   |
| Evidence-based topic status with a one-line reason; nothing marked Mastered automatically                                                         | Anki, RemNote                          | **Done** (status changes are one-tap proposals)                                                            |
| Evening wrap-up on Today                                                                                                                          | Sunsama                                | **Done**                                                                                                   |
| "Enough time?" cushion: estimated study hours vs free hours before each assessment                                                                | Shovel                                 | **Done**: Today's This week card compares estimated work due in 7 days with free scheduling time           |
| Visible reasons when the scheduler moves or declines work                                                                                         | Motion, Reclaim                        | Next                                                                                                       |
| Ask Life OS: deterministic answers to "What should I focus on?", "What am I neglecting?", "Can I finish this week?", each citing the records used | LifeOS AI-style assistants             | Next. The assistant exists with Groq and source records; add deterministic answer cards with no AI needed. |

## P2: useful

| Item                                                   | Notes                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| FSRS review queue per topic (ts-fsrs, MIT)             | Needs real recall ratings from the owner. Never inferred from opening a file.                    |
| Per-calendar buffers (e.g. 15 minutes after practices) | Generalises game-day buffers                                                                     |
| GPA forecast from course targets                       | Needs SFU letter-grade cut-offs per course from syllabi (PSYC 100's are already in its syllabus) |
| Drop-lowest for points-based courses (PSYC ZAPS)       | **Done**: the points calculation drops the lowest graded result in drop-lowest categories        |
| Beedie transfer requirement tracker                    | Needs SFU Beedie admission requirements entered or linked                                        |

## P3: experimental

| Item                                  | Notes                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Gmail starred-mail intake into Inbox  | Needs a new OAuth scope; Google's quota page mentions possible future overage charges, so wait |
| Second AI provider (Gemini free tier) | The provider layer is ready; free limits are unclear in 2026                                   |

## Rejected

- n8n, Activepieces, Zapier: extra hosting or cost, and native crons are enough.
- A Notion-style notes database: complexity without matching value.
- NotebookLM integration: no public query API.
- Duplicate task systems (Vikunja, Todoist sync): they break single-source-of-truth.
