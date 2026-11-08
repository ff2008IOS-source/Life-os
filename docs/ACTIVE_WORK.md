# Active owner priorities — November 8, 2026

The owner excluded the shooting chart and prioritized agenda items 7, 8 and 9.

- **7 — Calendar clarity:** PR #15 merged; production deployment is READY. Login responds 200; anonymous calendar/assistant API requests return 401. Authenticated owner/device confirmation remains separate from these probes.
- **8 — Conversational weekly reviews:** current feature branch adds one conversation per review week, bounded recorded evidence, carry-forward notes, reviewed summaries and explicitly captured task drafts. The written review remains available without AI.
- **9 — Connected Home:** the same branch adds a saved-name/time-sensitive greeting, an explained next action that excludes blocked tasks, urgency-ranked Top 3, task/project/goal links and goal-linked task lists. This is a first functioning slice; customizable cards, new brand artwork and broader outcome recommendations remain future work.

Google Sheets REST work is preserved in a local stash on the paused Sheets branch. It has not been activated, deployed or applied to the hosted database. No shooting-chart edits are planned.

## Review release safeguards

- Existing Free-plan AI opt-in, daily/token limits, server credentials and prompt-injection boundaries remain enforced.
- AI summaries are drafts until the owner saves them. Creating a proposed task requires opening its draft and pressing Save task. There is no automatic commitment or goal/mastery update.
- Review weeks select Vancouver-local date boundaries. Evidence is a bounded subset with explicit coverage limitations; current overdue work is labeled as current, not retroactively attributed to an old week.
- Review/conversation links use composite ownership foreign keys, unique identities, owner-only SELECT RLS and a service-only invoker RPC. The RPC locks the owned review before checking/creating its link.
- Additive migration only: new review summary column and association table. Existing notes and conversations are preserved. If UI rollback is needed, redeploy the previous app; leave the additive schema in place. Do not drop owner reflections as a rollback shortcut.
- Export includes summaries, original conversations and association records. This does not certify full hosted disaster recovery.
- No external Google/Canvas writes, new paid services or automatic outbound sync are introduced.

## Verification distinctions

Local PGlite tests exercise migrations, permissions and ownership. Browser provider replies are mocked for repeatable conversation/approval tests; these are not evidence of live Groq tutoring quality. Production owner sign-in, private data retrieval and physical-device behavior require separate verification. Deployment/CI evidence is recorded in the pull request.
