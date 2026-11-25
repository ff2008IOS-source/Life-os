# Architecture

Updated 2026-11-25.

## Stack

- **Next.js App Router** on Vercel Hobby: a catch-all page (`src/app/[[...path]]/page.tsx`) and route handlers under `src/app/api`.
- **Supabase Postgres** with row-level security on every user table. The approved-user check is `public.is_approved_user()`. Server-only secrets (service key, Google, Canvas, Groq) live in Vercel environment variables.
- **Time zone:** America/Vancouver throughout (`src/lib/display.ts`, `src/lib/dates.ts`).

## Data flow

- **Canvas.** An encrypted access token feeds `canvas_reconcile`, which writes terms, courses, assignment groups and assessments. Files are seeded into `canvas_documents`. The text worker splits them into `canvas_document_chunks`, with full-text search via a `tsvector`.
- **Google Calendar.**
  - OAuth flows to `calendars` and `calendar_events`.
  - Refreshes run on demand plus once a day (Vercel cron at 13:00 UTC).
  - The work-block scheduler writes `work_blocks`.
- **Google Sheets.** A two-way ledger in `sheet_rest_datasets`, `sheet_rest_rows` and `sheet_rest_operations`, with conflict and approval states.

## Planning

- **`src/lib/scheduler.ts`** is the deterministic scheduler. Its policy:
  - 9–21 window;
  - at most 240 minutes a day;
  - sessions of 25–90 minutes with 10-minute breaks;
  - a 60-minute freeze;
  - a 7-day horizon;
  - a 24-hour deadline buffer.
- **`src/lib/today-agenda.ts`** builds the Today model: free windows, clashes (two repeating events never clash), suggestions, "do this next", deadlines and the weekly summary. It now uses the policy window, and protects 90 minutes before and 30 minutes after games.
- **`src/lib/wrap-up.ts`** builds the evening close-out from recorded tasks. "Find time" sets `scheduling_mode = eligible`, handing the task to the scheduler.

## Academics

- **`src/lib/academic-grades.ts`** calculates syllabus-weighted grades. A plain average is never shown.
- **`src/lib/grade-scenario.ts`** answers "what you need" for a target final grade.
- **Topics** (new):
  - `study_topics.suggestion_state` is `active`, `suggested` or `dismissed` (migration `20261125060000`).
  - `POST /api/v1/academics/topics` with `action: "find"` reads up to 6 unread, readable files per run, about 6,000 characters each.
  - It calls the provider layer (`src/lib/ai/structured.ts`, Groq first) for a strict-JSON topic list, falling back to `headingTopics()`.
  - It dedupes against existing topics, then inserts **suggested** rows keyed `canvas-file:<id>`. A dismissed marker row records files that yielded nothing, so they aren't re-read.
  - `action: "decide"` approves or dismisses suggestions.
  - `readAcademics()` returns only active topics as `study_topics`, with suggestions as `topic_suggestions`. The briefing and work-context readers filter to active topics.
- **`topicSignal()`** is a pure function giving the evidence behind a topic. A low matched score proposes _Needs review_; a recent session proposes _Practicing_; practice older than 14 days proposes _Needs review_; an exam within 14 days only raises urgency. Mastery is never inferred.

## AI provider layer

`src/lib/ai/structured.ts` defines a list of providers, each with `available()` and `call()`, behind zod-validated JSON output.

- **Fallbacks:** it throws `AiUnavailable` on 429, network or shape errors, and callers switch to deterministic logic. There is no paid fallback.
- **Adding a provider:** append another object to the list.

## Security

- **Ownership:** all reads and writes go through the user's authorised Supabase client (RLS applies). Mutations check `checkMutation` (origin).
- **Secrets:** AI keys and tokens are server-only; nothing secret reaches the browser.
- **Technical details:** shown only when the owner turns them on (Settings → Data).
