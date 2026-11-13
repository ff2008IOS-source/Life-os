# Life OS consumer interface

This increment builds on the connected-execution branch (PR #20). It changes presentation and navigation, with no new schema, provider permissions, production records, infrastructure or dependencies.

## What changed

- Warm neutral surfaces, a deep-teal focus card, mint accents, consistent typography, rounded surfaces and restrained shadows. Light, dark and system appearance remain available. The existing Life OS mark is shared by sign-in and the workspace.
- Home makes one action prominent and places the week summary alongside it on larger screens. Phone summaries are compact, cards align to the same edges, and today's schedule comes before secondary task lists. Empty deadline cards and zero-count list badges are omitted.
- An upcoming unfinished assessment can fill the focus card when no task recommendation exists. Its real course, title, date and verification status are used. “Plan preparation” opens that exact course/assessment without creating a task or calendar event. Past timed deadlines, submitted/excused assessments and dropped records are excluded from this fallback.
- Ordinary screens use plain language. Ranking mechanics, metric definitions, connection diagnostics and historical coverage explanations remain available in disclosures. Actionable warnings and uncertain dates are retained.
- Beta/development labels are removed from the main experience. Canvas progress describes updates and items rather than jobs/pages. Connection details are secondary; secure token entry and warnings are preserved.
- Reviews lead with the prepared week and conversation. Choosing commitments is a secondary action; approved task relationships and saved review history remain intact.
- Loading has a stable focus-card placeholder. Hover effects respect reduced-motion preferences. Mobile controls, keyboard focus and visual contrast are checked.

## Verification boundary

The automated suite has 269 tests and 22 browser workflows, including a new consumer-interface scenario. The browser scenario uses an isolated database and synthetic calendar responses, checks light/dark appearance at desktop (1280), iPad (834) and phone (390) widths, checks phone card alignment, and verifies that an assessment link opens the correct course and record. Screenshots are synthetic fixtures, not production data. Automated WCAG A/AA checks cover the core pages and forms.

TypeScript, lint, formatting, production build, parser tracing and the production-dependency audit are required before release. The full browser suite and targeted Canvas/review/appearance checks were run during development; final CI evidence is linked on the pull request.

Actual-device Safari behavior, the signed-in owner's hosted journey and subjective design preference need separate review. Provider integrations were not live-written or reauthorized for this UI work. Notifications, MFA and profile-picture activation remain unchanged. Production promotion is a separate reviewed step.
