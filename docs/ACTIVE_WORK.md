# Active work — Life OS Briefing, guided review and identity

The owner selected these three priorities and explicitly removed the standalone AI assistant from the product direction:

1. Finish a useful deterministic daily briefing, transparent next actions, attention items, saved daily check-ins and weekly insights.
2. Lead the weekly review with a prepared factual overview and a first question. Keep Groq inside this workflow, with its existing Free-plan controls and explicit approval before suggested commitments.
3. Add private profile-photo controls and a consistent logo/PWA icon.

Implementation is on `feature/life-os-briefing`. The earlier review/calendar releases remain preserved on main. Old conversations stay in a read-only archive; no conversation rows are deleted or automatically migrated. No OpenAI subscription/API or new provider is required.

Additive migration `20261113000755_life_os_briefing.sql` is applied to the existing Supabase database. Hosted checks confirm RLS, no anonymous reads of the new tables, and no new security-advisor findings. This database is shared by preview and production; the new app code remains a feature-branch/preview change until released. Preview exports include the new private records. The earlier production application does not yet expose their interface.

See [BRIEFING.md](BRIEFING.md) for calculations, accuracy limits, privacy and recovery. Tests exercise synthetic local records and mocked Groq replies. Live owner/Groq quality and physical-device behavior require separate verification.

The shooting chart is excluded. The earlier Google Sheets REST work remains preserved in its separate local stash and has not been resumed or activated. No external calendar, Canvas or spreadsheet writes are introduced by this increment.
