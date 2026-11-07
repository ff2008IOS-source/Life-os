# Assistant reliability fixes — 2026-11-07

This increment addresses eight problems in the owner's screenshots:

1. **Unsupported certainty:** a midterm query requires explicit midterm evidence. An imported “Exam 2” is a tentative candidate, not a confirmed next midterm. Practice and makeup items are excluded from ordinary next-exam lookup. A server response guard catches the reproduced unsupported midterm assertion and incorrect ISO calendar date, and retains source references.
2. **Wrong local date:** the server supplies Vancouver calendar dates and times. Date-only entries remain date-only; due deadlines are distinguished from exam start times. Both hosted PostgreSQL and application runtime use Vancouver's current timezone rules rather than a hardcoded UTC offset.
3. **Weak retrieval:** native imported assessments are linked back to their Canvas course by normalized course identity for material retrieval. Search examines page bodies, available syllabus, announcements and module titles, not just recent matching titles. Long-body excerpts preserve relevant coverage text; another numbered exam's coverage is excluded.
4. **Hidden evidence:** source chips are visible below replies, with unverified imports labeled. Detailed evidence remains expandable.
5. **Unrelated assessments:** strict midterm/final lookup and single-focus context avoid adding an unrelated knowledge test to a midterm answer.
6. **Generic, lengthy advice:** short, direct answers are requested, unsolicited numbered advice lists are suppressed, and long academic replies are bounded. Missing scope is reported as a retrieval limitation rather than an assertion that no material exists.
7. **Composer lost during scrolling:** the transcript scrolls inside a viewport-sized chat; composer and controls remain available. History/settings use accessible dialogs. Visual-viewport resize handling accommodates reduced space. Browser checks include long history and a short mobile viewport.
8. **Conversation blocked by an arbitrary minute:** replaces the fixed 61-second inter-message gate with a durable rolling token ledger, exact conservative per-request reservation and actual confirmed usage. Immediate follow-ups can fit the remaining window. Concurrent requests, the existing owner daily allowance and unknown outcomes remain guarded. Provider cooldown, token exhaustion and daily exhaustion are separate, with retry metadata and retained drafts. Expiry refreshes availability, never automatically resends.

## Hosted schema

`20261107081910_adaptive_assistant_limits.sql` was applied to the existing shared Supabase project for this requested fix. It adds owner-isolated rate metadata and a provider retry timestamp, backfills metadata from existing exchanges, and adds narrow authenticated owner/session/MFA-checked RPCs. Existing 20-message daily preference, three saved exchanges, three tasks and 88 assessments were preserved. Anonymous ledger access and claim execution are denied. Conversation deletion cannot reset minute or daily accounting. The previous four-argument claim RPC remains compatible.

## Verification

164 unit/database tests passed in the final full run, including reproduced midterm/date errors, deep material retrieval, course relinking, token reservation, immediate follow-up, concurrency, history deletion, ownership isolation and separate provider/daily limits. TypeScript, lint, formatting and production build pass. Focused browser checks cover cooldown/draft retention, no automatic resend, transcript scrolling, composer visibility, responsive widths, source chips and automated accessibility. Final full browser regression results and preview URL are recorded on PR #2.

## Limits and release status

The production application is not promoted. No new calendar or source-Sheet writes, paid services or live Groq calls were made by the agent. Synthetic provider responses test application behavior, not the quality of a live model answer. Retained historical AI replies are not rewritten. PDF/PPT file metadata is not extracted body text; old practice keys do not establish current exam coverage. Missing official scope remains explicitly unconfirmed.

Security advisors flag deliberately authenticated SECURITY DEFINER helpers and deliberately service-only tables; their ownership checks and grants were reviewed. Existing leaked-password protection warning is unchanged: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection .
