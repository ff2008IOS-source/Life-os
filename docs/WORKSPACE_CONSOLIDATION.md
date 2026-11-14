# Personal workspace consolidation

This increment builds on the consumer interface in PR #21. It preserves records and external permissions. There are no schema migrations, paid services, production provider writes, or new AI dependencies.

## Implemented checklist

- [x] Home owns the daily briefing, next action, attention items and daily check-in. `/briefing` and the former assistant entry redirect there. Past conversations remain accessible from Privacy & account.
- [x] Weekly statistics live in Insights. Weekly Review owns the guided conversation, approved reflection and commitments. Review dates and the factual overview are secondary disclosures; saved history remains intact.
- [x] Each course has Overview, Assessments, Materials and Study sections. Materials resolve an existing, unambiguous owner-scoped Canvas mapping. Unlinked or ambiguous courses display a missing-link state instead of another course's content. The separate Canvas library retains access to other imported records.
- [x] `/canvas-materials` redirects into Academics. `/canvas-connect` opens the Canvas connection controls inside Settings. Token entry, validation, rotation and read-only source protection are preserved.
- [x] Career owns the connected spreadsheet roadmap. Projects owns deliverables and links back to the roadmap; its redundant Projects tab is removed. No source records or outbound approvals are removed.
- [x] Planner owns saved scheduling preferences, automation controls and reservations. Settings links to Planner. Saved boundaries load before planning is enabled. A guarded PATCH saves boundaries without changing automation, with optimistic version checks to reject stale writes. Existing POST callers retain compatibility while omitted policy now preserves saved boundaries.
- [x] Appearance has one account-backed control in Settings. Mobile More links there rather than changing a temporary local theme.
- [x] Attention lives on Home. Earlier notification records are available on demand; reminder preferences remain in Settings. No notification preference, MFA setting or profile picture is activated by this increment.
- [x] Search explicitly describes its current scope: tasks, projects and goals. It does not imply it searches all academic materials.
- [x] Loading, missing connections, missing records and errors have distinct states in the changed workflows. Settings mounts only the chosen section. Academic content receives the full available width; light/dark styling and responsive controls use the existing design system.

## Verification

The new browser workflow exercises old-route redirects, navigation consolidation, saved scheduling boundaries across refresh, optimistic concurrency, rejected foreign-origin requests, unauthorized requests, mapped course materials, unlinked course isolation and responsive academic layouts. It uses a loopback-only synthetic Supabase adapter backed by PostgreSQL (PGlite). Its server-role credential is an explicit synthetic constant supplied only by Playwright; no production secrets or data are used. Existing mocked Canvas and Sheets scenarios remain distinct from live-provider verification.

Final check results and the hosted preview are recorded in the pull request. A prior check caught a missing OR-filter implementation in the test adapter; the adapter now parameterizes the exact supported Canvas course filter. Another check caught a hidden App Router view during reload; the assertion checks the visible view rather than accepting ambiguous controls.

Physical iPhone/iPad Safari, the signed-in owner's hosted journey, continuous provider synchronization and production release are separate verification steps. This increment does not assert complete exam coverage, enable real calendar writes or change the owner's automation settings.

The final UI pass also keeps completed check-ins compact, places full saved answers behind a disclosure, and omits free-time quantities when the value is unavailable. Turning automation on requires saved boundaries; turning it off does not overwrite draft boundaries. Preference toggles preserve the server's saved policy. Course mappings with conflicts have a distinct review-needed state, and ambiguous mappings never select an arbitrary source.

Failure-state browser checks also change the selected Canvas library course and check-in date while injecting a temporary read error. Previous content must disappear, file preparation must remain disabled, and retry must recover without assigning yesterday’s answers or another course’s content to the new selection. The existing CI verification workflow also runs for this PR’s consumer-interface base branch.
