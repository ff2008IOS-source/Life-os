# Warm minimal workspace redesign

## Repository baseline

Next.js 16 App Router, React 19, TypeScript, Tailwind plus shared CSS, Radix dialogs, Lucide icons, Supabase owned records, Google Calendar/Sheets and Canvas integration routes. The authenticated catch-all workspace route shares WorkspaceProvider, WorkspaceShell and FocusSessionProvider. Existing APIs, ownership checks, importer ledgers, scheduling preferences and persistence remain the foundation.

## Implemented presentation and interactions

- Semantic warm dark/light tokens, accessible muted text/control boundaries, consistent geometry, spacing and transitions. Locally hosted Inter and Instrument Serif with their OFL licenses. No added packages or runtime font service.
- Stable sidebar, compact header, cookie-backed collapse preference, compact phone navigation, existing command search plus workspace/course results and keyboard result navigation. Duplicate area navigation and the decorative footer removed.
- Task-first Today with day navigation, persisted inline capture and optional advanced fields, separate completed tasks, contextual schedule, accurate upcoming assessments and defined weekly task counts. Existing focus/pause/resume/finish, priority explanation, task edits, completion confirmation, undo, check-ins and connection diagnostics remain accessible.
- Optional dashboard sections retain saved settings, show/hide, reorder, pinning, density and resizing. Core Today/task/schedule hierarchy stays fixed. Landscape and greeting decoration is no longer rendered; saved preferences are not erased.
- Shared presentation extends through Planner, Academics, Career, Projects, Reviews, Insights, Settings and authentication. Calendar categories are restrained; event details can open from the compact schedule. Course Grades and Notes tabs reuse existing records and editors; target scenarios never save hypothetical grades. Unknown possible points block point-based projections.
- Project directory search, expandable task/milestone content and existing recoverable deletion. Review history search and existing Sunday gate preserved.
- Dedicated Basketball Ops and Learning navigation. Ops reads actual associated work, team calendar sources and explicitly configured Player/Made/Attempts tables. It validates counts and source identity, supports player search/sorting and CSV export. Invalid or partial previews cannot export. Learning surfaces connected skill paths and actual academic topic mastery, linking to existing workspaces.

## Safety and scope

No live activity reset, source writes, invented records, schema changes or paid infrastructure are part of this redesign. Source-backed reporting requires matching connected columns; an absent source produces an empty state. A partial source preview is labelled and cannot be exported as a complete report. Actual grades, projected grades and learning mastery remain distinct.

This is a coherent application-wide redesign, not completion of every potential new feature in the master specification. A new lesson-authoring engine, basketball-specific report/PDF pipeline, generalized project file/bug system and entirely new project board/timeline are not claimed. Existing academic study, materials, saved plans and operational project workflows remain available.

## Verification

Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e` and `npm run format:check` before release. Browser fixtures use a loopback database and synthetic account only. The warm workspace tests cover desktop/tablet/phone overflow, keyboard search, persistent sidebar state, inline task persistence, automated WCAG checks and shooting report validation/export. Existing browser tests retain task completion/restore, recurrence, academic records, review gating, scheduling conflicts, source permissions and failure handling.

Automated Chromium and axe checks are not a substitute for native iPad Safari, VoiceOver or the owner's real OAuth/account checks. Report these limitations with the actual release results; do not infer verification from the existence of a test.
