# Life OS — website to-do list

Audit of the live site (https://lifeos-beta-ivory.vercel.app) on Nov 23, 2026, after the Today redesign (#30, #31).
Every main page was opened signed in, at desktop (1280 px) and phone (390 px) widths, with load timing, request and byte counts, browser errors, automated WCAG 2.2 AA checks (axe), tap-target sizes and screenshots, plus a code review. Nothing was changed while auditing.

Priority: **P0** broken or blocks daily use · **P1** noticeably hurts use · **P2** polish.
Effort: **S** under an hour · **M** a few hours · **L** a day or more.

## Summary

| Area               | P0    | P1     | P2     |
| ------------------ | ----- | ------ | ------ |
| Data & sync        | 3     | 3      | 1      |
| Speed & efficiency | 0     | 3      | 2      |
| UI & UX            | 0     | 11     | 9      |
| Accessibility      | 0     | 2      | 2      |
| Data quality       | 0     | 4      | 1      |
| Security & ops     | 1     | 2      | 1      |
| **Total**          | **4** | **25** | **16** |

What already holds up: no JavaScript errors on any page, no sideways scrolling on phone, server response under 200 ms everywhere, and only one automated accessibility issue across 25 pages.

---

## 1. Data & sync

- [ ] **P0 · S (you)** **Google Calendar and Sheets stopped updating on Nov 21.** The last successful calendar sync was Nov 21 6:50 AM. Every refresh since returns 502, and all 8 Career sheet tables show "This plan may be out of date". Most likely an expired Google sign-in. _Fix:_ Settings → Connections → Reconnect Google.
- [ ] **P0 · M** **Settings says "Connected" and "Synced" while every sync fails.** A failed refresh never sets `sync_error` on the calendar (`src/lib/integrations/calendar-freshness.ts`), so the status hides the outage. _Fix:_ save the failure reason (for example "Google sign-in expired") on the connection and calendars, and show it in Settings, the Today header and the Planner banner with a single "Reconnect" button.
- [ ] **P0 · M** **The daily automatic refresh fails silently.** The 6–7 AM refresh didn't run successfully on Nov 22 or 23 and nobody was told. _Fix:_ when the daily job fails, record it and show "Daily refresh failed — reconnect Google" on Today. Optionally send a push notification, which is already wired.
- [ ] **P1 · S** **A failed refresh blocks retries for the whole freshness window.** After a 502, the next page load gets `refresh_already_requested`, so nothing retries until the time bucket rolls over. _Fix:_ when the job fails, release the bucket or mark it failed so the next visit can retry, with a short backoff.
- [ ] **P1 · S** **The same refresh is triggered from several pages.** Opening Planner, Career or Settings → Connections each fires three to six `/api/v1/calendar/sync` requests on load (`use-calendar.ts`, `google-calendar-panel.tsx`, `career-panel.tsx`). The server de-duplicates them, but it's wasted work and causes error noise. _Fix:_ one app-level "refresh if stale" check per session.
- [ ] **P1 · M** **The Canvas section on Settings → Connections shows no status** (a collapsed row with a stray triangle above the title). You can't tell whether Canvas is connected or when it last synced. _Fix:_ give it the same status row as Google Calendar.
- [ ] **P2 · S** **The "SFU" calendar is stored in the UTC time zone** while the others use Vancouver time. Timed events are unaffected, but all-day SFU events can land on the wrong day. _Fix:_ treat Vancouver as the display zone for all-day events, or fix the calendar's zone in Google.

## 2. Speed & efficiency

- [ ] **P1 · L** **Every page downloads the whole app: 1.09 MB of JavaScript (about 300 KB compressed).** All pages render through one catch-all route (`src/app/[[...path]]/page.tsx`) that imports every page component. The main chunk alone is 537 KB and includes all zod schemas and `rrule`. _Fix:_ split into real routes (`/planner`, `/areas/...`, `/settings`) or lazy-load page components with `next/dynamic`.
- [ ] **P1 · M** **Every navigation reloads the whole workspace on the server.** `loadWorkspace()` runs on each request (`dynamic = "force-dynamic"`) and fetches every task, goal, project and milestone even for Settings. _Fix:_ load only what a page needs, or cache the workspace per request and reuse it on the client between pages.
- [ ] **P1 · S** **Today is the slowest page** (3.6 s to settle, 32 requests, 1.6 MB). It waits on the full briefing, which also builds attention items and weekly data. _Fix:_ send the agenda inputs first and load the collapsed "Day review" panel only when it's opened (already partly done).
- [ ] **P2 · M** **The Career page has 1,590 DOM nodes and is 4,400 px tall**, because it renders 8 roadmap tables plus every project card in full. _Fix:_ collapse the project cards or move them to Projects (see UX), and render roadmap rows lazily.
- [ ] **P2 · S** **Insights fetches the whole briefing** just for one "Useful next step". _Fix:_ use a smaller endpoint, or drop that block (it duplicates Today).

## 3. UI & UX

### Naming and structure

- [ ] **P1 · S** **Page titles don't match the menu.** The menu says Week and School, but the pages say "Planner" and "Academics". Growth's title is "Where you're headed". _Fix:_ make each page title match its menu label.
- [ ] **P1 · S** **Leftover pages.** `/areas` still shows the old three-workspace view and `/more` is titled "Workspaces". Neither is in the menu any more. _Fix:_ redirect `/areas` to `/growth`, and retitle `/more` as "All pages" or remove it.
- [ ] **P1 · M** **Projects appear in three places.** Project cards show on Career (in full), on Projects and on Goals (Milestone 1/2 exist as both goals and projects). _Fix:_ show projects only on Projects, and link to them from Career and Growth.

### Week (Planner)

- [ ] **P1 · M** **Canvas deadlines are repeated below the calendar** as six tall cards of roughly 130 px each, duplicating Today's "Due this week". _Fix:_ show deadlines as markers in the calendar (the "Deadlines" filter exists) and drop the list, or make it a compact table.
- [ ] **P1 · S** **Friday's "5 overlapping events" block fills the whole day column** and hides the timeline. _Fix:_ stack the events side by side or show "+4 more" inside the hour, not across the day.
- [ ] **P2 · S** **"Check changed or missed work blocks" floats as a loose link** under the page title on Planner, Reviews and Today. _Fix:_ only show it when blocks were actually missed, as a banner with a count.
- [ ] **P2 · S** **The week view opens at about 7 AM, cutting off the first event.** _Fix:_ scroll to 30 minutes before the first event of the week.

### School (Academics)

- [ ] **P1 · S** **The course picker floats in the middle of the row** with an "Edit course" link far right; "All terms" and the course picker aren't grouped. _Fix:_ put the term and course pickers side by side on the left and the actions on the right.
- [ ] **P2 · M** **The Overview tab shows counts, not grades.** It says "1 result · To confirm · 2 pending", but your 87.5% sits further down. Insights also shows "17 results" per course with no average. _Fix:_ lead with the current percentage or grade per course, and "what's left and what you need on it".
- [ ] **P2 · S** **"1 topics" grammar** on Insights → Topics to review.

### Growth (Career, Goals, Learning)

- [ ] **P1 · S** **Career roadmap sections are out of order**: Year 3, 4, 1, 2; Spring 2029 before Fall 2026; Spring 2028, 2029, 2030, 2027. _Fix:_ sort by year and term.
- [ ] **P1 · S** **"This plan may be out of date" repeats eight times** on Career. _Fix:_ one banner at the top with a single Reconnect action.
- [ ] **P1 · M** **Goal cards show raw imported text**, such as "Area: Portfolio Deadline: 2026-11-10 Evidence: … Goal: … Metric: …", which repeats the title. Each card also carries "qualitative", "Progress through reflection" and "Linked tasks (0)". _Fix:_ split the imported text into proper fields (evidence, metric, deadline), hide internal tags, and show a "Next step" line like Growth does.
- [ ] **P1 · S** **Contacts look empty when they aren't.** "Contact follow-ups" says "No confirmed contacts" while Professional contacts lists four people right above it. _Fix:_ offer "Confirm" on imported contacts, or merge the two lists.
- [ ] **P2 · M** **Learning lists 30+ study topics in one flat list**, with statuses in small grey lowercase. _Fix:_ group by course, put "needs review" first, add a filter, and make status a coloured chip.
- [ ] **P2 · S** **Weekly reflections are labelled with future dates** (Jan 4, 2027; Dec 7, 2026), so the "Week Of" values in the sheet look wrong. _Fix:_ check the source sheet.

### Settings

- [ ] **P1 · M** **The Sheets section reads like developer tooling.** It shows "Connected account · ddeb5e4c", "Verify a disposable workbook", an "Open primary Life OS integration settings" link that points to the same page, and a raw table picker. _Fix:_ show the account email, one line per sheet with status and a Sync button, and move the test and verification tools under Advanced.
- [ ] **P2 · S** **Settings sections have different widths**: "Connected data" spans the page while everything below is narrower. _Fix:_ one consistent content width.

### General

- [ ] **P2 · S** **Long phone pages**: Career is 6,500 px, Learning 5,000 px, Goals 4,300 px. Collapsing by default (see above) fixes most of this.
- [ ] **P2 · S** **Quick capture card on Today has empty padding** inside the capture component. _Fix:_ tighten the spacing.

## 4. Accessibility

- [ ] **P1 · S** **Small tap targets on Reviews**: two disclosure rows are under 24 px tall (axe `target-size`). _Fix:_ give them a minimum height of 44 px.
- [ ] **P1 · M** **Small tap targets elsewhere** (under 32 px): Materials has 112 file and folder links, Career 56, Planner's view switchers and filters 25, Goals 24. These are hard to hit on a phone. _Fix:_ give rows and chips a minimum height of 44 px.
- [ ] **P2 · S** **Week-view event blocks use 10–11 px text.** _Fix:_ raise it to at least 12 px.
- [ ] **P2 · S** **"Search ⌘ K" button text** includes the shortcut. _Fix:_ hide the shortcut from screen readers.

## 5. Data quality

- [ ] **P1 · S** **Test data is mixed in with real data**: the goal "[TEST] Explore a complete workflow", the task "[TEST] Finish the beta walkthrough", and the sheet "[TEST] [TEST] Life OS Sheets verification". _Fix:_ delete them, or hide `is_example` records everywhere by default.
- [ ] **P1 · S** **All 9 active goals have no next step**, and 2 are past their target (Milestone 1: Nov 3, Milestone 2: Nov 10). _Fix:_ this one is yours: use Today → "Keep your goals moving".
- [ ] **P1 · S** **Two goals duplicate projects**: Milestone 1 and Milestone 2 exist as both. _Fix:_ keep them as project milestones and delete the goal copies.
- [ ] **P1 · S** **Two PHIL 100W entries look like the same paper**: "Nov 24 Writing Assignment" (4:20 PM) and "Second paper" (11:59 PM), both due Tuesday. _Fix:_ confirm in Canvas; if they're the same, mark one as a duplicate so it isn't planned twice.
- [ ] **P2 · S** **Inbox tasks have no estimates** ("Estimate missing"), so they can't be planned. _Fix:_ prompt for a quick estimate when capturing.

## 6. Security & operations

- [ ] **P0 · S (you)** **Change the account password.** It was shared in a chat on Nov 23.
- [ ] **P1 · S** **Turn on MFA** if it isn't enrolled. The app supports it under Privacy & account.
- [ ] **P1 · S** **No error monitoring.** The 502s were only found by visiting the site. _Fix:_ log failed provider calls into a small "health" table and show them on Today (see section 1), or add free-tier error reporting.
- [ ] **P2 · S** **Remove `life-os-source.zip` from the repo** (186 KB). It's a stale copy of the source.

---

## Suggested order

1. Reconnect Google and change the password (you, 5 minutes).
2. Sync honesty: save and show the failure, release the retry lock, alert when the daily refresh fails (section 1, P0/P1).
3. Quick wins: page titles, sort the Career roadmap, one "out of date" banner, delete test data, tap targets, the leftover `/areas` page.
4. Clean-ups: goal cards, the Sheets settings, the deadlines list in Week, duplicated projects.
5. Performance: split the app bundle and stop reloading the whole workspace.
