# Implementation log

Status keys: **Proposed**, **Planned**, **Implemented** (code merged), **Tested** (automated tests pass), **Production-verified** (checked on https://lifeos-beta-ivory.vercel.app with the owner's account).

## 2026-11-26: email you can act on

| Change                                                                                                                                                                                        | Status              | Notes                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
| Today → **What changed**: up to 3 unseen updates from the last 7 days, each with one action and Seen; hidden when there's nothing new                                                         | Implemented, Tested | Replaces the old Course updates card                                                                 |
| Suggested actions (`update-actions.ts`): enter a mark, move an assessment's date, check grading rules, add a task from a dated personal email                                                 | Implemented, Tested | Plain rules; nothing changes until the owner taps. The syllabus record wins over a blank Canvas copy |
| Crowdmark workaround: inline mark entry with the exam pre-selected, plus **Read screenshot** (Groq free vision model, reply checked by a schema, owner confirms)                              | Implemented, Tested | Crowdmark has no student API and its emails carry no score                                           |
| School course **Updates**: "Needs your attention" pinned, then Recent, Show all, and search over 5+ updates                                                                                   | Implemented, Tested |                                                                                                      |
| Week → Inbox → **SFU mail**: people first, then groups (Registrar & enrolment, Money, Athletics, Housing, Research credits, Library, Canvas, Orders & accounts, Other) with counts and search | Implemented, Tested | Groups with new mail start open                                                                      |
| ⌘K search and Ask Life OS include emails and announcements                                                                                                                                    | Implemented, Tested | The assistant cites the email (`mail:` source IDs), treated as untrusted text                        |
| Imported history older than 14 days marked as seen                                                                                                                                            | Done in production  | So only current items ask for attention                                                              |

## 2026-11-26: Gmail bridge every 5 minutes; Outlook panel removed

| Change                                                                                              | Status              | Notes                                                                                                                                      |
| --------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| The Gmail script runs every 5 minutes (was hourly) and no longer re-sends recent emails on each run | Implemented, Tested | Owner request. Well inside the free Apps Script trigger quota                                                                              |
| The SFU Outlook panel is removed from Settings                                                      | Implemented         | SFU blocks students from registering apps in Microsoft Entra. The server routes and table stay, so it can return if SFU IT approves an app |

## 2026-11-26: direct SFU Outlook connection

| Change                                                                                                            | Status              | Notes                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings → SFU Outlook: Microsoft sign-in with read-only mail access (`Mail.Read`, `offline_access`, `User.Read`) | Implemented, Tested | Public client with PKCE, so no client secret. The owner registers a free app in Microsoft Entra and pastes its client ID. SFU may require IT approval; if so, the panel says so                          |
| Imports the whole mailbox, newest first, then keeps checking for new mail                                         | Implemented, Tested | Skips Sent, Drafts, Deleted, Junk and Outbox. Resumes where it stopped; runs while Settings is open and briefly whenever course updates sync. The email's own Message-ID dedupes against the Gmail route |
| Refresh token encrypted with the server key (AES-256-GCM, per-owner AAD)                                          | Implemented         | The owner's API never returns it                                                                                                                                                                         |

## 2026-11-26: SFU mail only, plus older SFU mail

| Change                                                              | Status              | Notes                                                                                                                                          |
| ------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Only SFU mail is sent and stored (to, cc or from an sfu.ca address) | Implemented, Tested | Owner correction. The script's Gmail search is SFU-only, and the server drops anything else. The 25 non-SFU emails already copied were deleted |
| Older SFU mail forwarded from Outlook as attachments is unpacked    | Implemented, Tested | `postal-mime` (MIT-0) parses each .eml for its original sender, date and text. Message-ID dedupes against mail that was already redirected     |
| No 60-day cleanup for SFU mail                                      | Implemented         | So older mail stays readable. The Email list shows the newest 100                                                                              |

## 2026-11-26: all incoming email (superseded)

| Change                                                             | Status              | Notes                                                                                                                    |
| ------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| The Gmail script sends all new incoming mail, not just course mail | Implemented, Tested | Owner request. It remembers the newest email it sent; the server ignores repeats. Up to 250 conversations per hourly run |
| Password-reset emails are never sent or stored                     | Implemented, Tested | Checked in the script before sending, and again on the server. Sign-in codes are allowed (owner rule)                    |
| Non-course email goes to Week → Inbox → Email, kept 60 days        | Implemented, Tested | School and Today show only course-matched messages                                                                       |

## 2026-11-26: course updates

| Change                                                                                  | Status              | Notes                                                                                                                                                                           |
| --------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas announcements read for every linked course (last 60 days), synced at most hourly | Implemented, Tested | Flags messages that may change grading, move a date or time, or post a mark                                                                                                     |
| Forwarded course emails (Outlook rule → Gmail → Apps Script → Life OS)                  | Implemented, Tested | Private per-owner token, only its SHA-256 hash stored; ≤25 emails per post; no new OAuth scope and $0                                                                           |
| Course updates on Today and on each course in School, with "Seen"                       | Implemented, Tested | e2e: a forwarded email moving an exam appears on School and Today and can be marked seen                                                                                        |
| Crowdmark marks                                                                         | Documented          | Crowdmark has no student API. Marks reach Life OS when instructors export them to Canvas, or through the "your results are available" email, which is flagged "New mark posted" |
| Submitted work showing a Canvas placeholder 0 is treated as awaiting a mark             | Implemented, Tested | PHIL 100W was wrongly shown at 55%                                                                                                                                              |

## 2026-11-25: follow-up batch

| Change                                                                       | Status              | Notes                                                                                                                                       |
| ---------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Topics to review appear in course order (week 1, 2, 3…) with no labels shown | Implemented, Tested | `courseOrder()` reads week, lecture, chapter, unit, day and exam hints from each topic's notes and source file; mastered topics go last     |
| Suggestions no longer show their section label                               | Implemented         | Owner request                                                                                                                               |
| Drop-lowest in points-graded courses (PSYC 100 ZAPS: "lowest dropped")       | Implemented, Tested | Matches Canvas: the lowest graded result in the category is dropped                                                                         |
| "Can I fit this week?" on Today                                              | Implemented, Tested | Shovel-inspired; estimated minutes due in 7 days vs free time inside 9–21, capped at 240 min/day; items without estimates listed separately |

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
