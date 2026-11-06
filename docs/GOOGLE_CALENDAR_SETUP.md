# Read-only Google Calendar (Stage B)

The owner authorized real Calendar, career spreadsheet, and confirmed-record imports on 2026-11-06 and explicitly deferred hosted backup/restore verification. This does not approve calendar writes, automatic scheduling, paid services, or daily-use release. Hosted recovery remains unverified.

## Google setup

Use a Google Cloud project with Calendar API enabled (no billing required). Configure an External OAuth app and add the owner's Google account as a test user. Create a Web application OAuth client with this exact redirect URI:

`https://lifeos-beta-ivory.vercel.app/api/v1/calendar/oauth/callback`

No JavaScript origin is required for the server authorization-code flow. The application requests OpenID/email plus `calendar.calendarlist.readonly` and `calendar.events.readonly`. It uses PKCE, a user-bound encrypted HttpOnly state cookie with a ten-minute lifetime, and the existing approved Life OS session. It requests no calendar write scopes. Consent is separate from Supabase sign-in.

Production server-only Vercel variables:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET` (Sensitive)
- `SUPABASE_SECRET_KEY` (Sensitive; never a NEXT_PUBLIC variable)
- `LIFE_OS_CREDENTIAL_KEY` (Sensitive; base64 encoding of 32 random bytes)

The token encryption key is stored separately from PostgreSQL. Losing it requires reconnecting Google; exporting application records does not recover credentials. A separate key was generated and saved directly to Vercel without printing or committing its value. Never replace it while a connection is active.

Google External apps in Testing can issue short-lived refresh grants (typically seven days for these scopes); reconnect when prompted. This configuration does not promise indefinite unattended access or verified OAuth publication. Review current Google OAuth documentation before changing publishing status.

## Workflow

1. Sign in to Life OS and open Settings.
2. Connect Google Calendar and grant both requested calendar read permissions.
3. Explicitly select the approved calendars. Nothing is selected automatically, and calendar colors/names are not modified in Google.
4. Sync selected calendars. Each calendar is processed separately, sequentially, with visible success/failure status.
5. Open Planner to view cached Google events alongside task deadlines. Home shows today's cached events and a cached upcoming count when coverage exists.

## Actual sync behavior and limits

Synchronization is on demand, not continuous. Each successful calendar sync atomically replaces the expanded event snapshot for the past 30 days through the next 90 days. Recurring instances are expanded by Google and retain provider instance IDs and original-start metadata. All-day end dates remain exclusive. Original Google colors are stored locally. Events outside the current window are retained as historical cache, not marked deleted merely for falling outside coverage.

This first live adapter uses bounded full-window refreshes rather than incremental cursors: rolling recurrence expansion and an explicit coverage window are preferred to presenting unexpanded series as real agenda instances. The existing offline incremental adapter remains tested but is not wired to live persistence. Historical all-time calendar migration, arbitrary-range live fetches, timed background sync, push delivery, and automatic availability-based scheduling are not implemented.

Each sync has a 10,000-instance cap and a bounded provider request deadline. The prior cache survives provider/page/validation failures. A 90-second database lease prevents concurrent sync commits; abandoned leases expire. The entire event/cursor-free snapshot and coverage update commits in one SQL transaction. Retries use unique provider IDs and update external changes without provider writes. Missing instances within the successfully fetched window are cancelled locally. Inaccessible calendars are disabled when the calendar list is refreshed.

Disconnect calls Google's revocation endpoint, removes the encrypted local credential and disables the calendars. Cached records remain available in the private export but are hidden from active Calendar views.

## Security and verification

The integration service verifies the Supabase user and approved account before obtaining its server-only Supabase client. Integration RPCs are executable only by `service_role`; `anon` and `authenticated` cannot read encrypted tokens or invoke provider-state writes. Private credential tables retain RLS with no client policies. Provider records remain SELECT-only for the approved owner. No Google write transport exists in this adapter.

Synthetic tests cover user-bound OAuth state, expiry, read-only scopes, PKCE, encrypted credential isolation, exclusive all-day boundaries, provider pagination, recurring instances, idempotent updates, transactional failure rollback, expired/concurrent leases, revocation and disconnect. Browser calendar-control tests mock provider-state HTTP responses; they do not prove a live Google account connection. Real consent, selected calendars and initial sync must be verified by the owner after deployment.

Official references:

- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/identity/protocols/oauth2#expiration
- https://developers.google.com/workspace/calendar/api/guides/sync
- https://developers.google.com/workspace/calendar/api/v3/reference/events/list
