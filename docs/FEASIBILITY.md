# Phase 0 — feasibility and architecture

Reviewed 2026-11-06. No external resources or personal data accessed.

## Budget

Vercel Hobby + Supabase Free + standard Google API quotas + free subdomain: $0 CAD additional monthly cost while within quotas. Never upgrade automatically. Availability may stop at quota exhaustion or database pausing. No paid AI dependency.

- Vercel Hobby is personal/noncommercial; cron is at most daily and not precise: https://vercel.com/docs/cron-jobs/usage-and-pricing
- Supabase Free: 500 MB database; low activity may pause after seven days: https://supabase.com/pricing and https://supabase.com/docs/guides/platform/free-project-pausing
- Free projects need independent exports: https://supabase.com/docs/guides/platform/backups
- Supabase pg_cron + pg_net is a candidate for later bounded workers; verify deployed extension access, quotas, authentication, retries and missed-run recovery before activation: https://supabase.com/docs/guides/functions/schedule-functions
- Edge Functions Free includes 500,000 invocations; not an availability guarantee: https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations
- Google external OAuth Testing refresh tokens normally expire in seven days: https://developers.google.com/identity/protocols/oauth2
- Calendar read scopes first; app.created only at Stage C: https://developers.google.com/workspace/calendar/api/auth
- Sheets standard use is free within quotas: https://developers.google.com/workspace/sheets/api/limits

## Architecture decisions

Next.js App Router + strict TypeScript + Tailwind + accessible Radix/shadcn-style primitives. Supabase SSR cookies, server-validated identity, approved email check, database allowlist and RLS. No service-role application queries. Zod at API boundaries. PostgreSQL is authoritative; no browser-storage task substitute. Dedicated service modules and version-checked edits. Explicit date-only deadlines; Vancouver local dates never parsed as UTC midnight deadlines.

Pure deterministic scheduling engine, no AI: hard constraints first, topological dependency ordering, deadline/priority ordering, bounded session placement, clear unscheduled reasons. Scheduling preview is non-writing. Work remaining accounts for completed actual work and existing reservations. Live apply must revalidate input revisions, availability and freeze windows.

Durable PostgreSQL jobs with leases, idempotency keys and retries; request-triggered initially. No setInterval or detached request workers. Supabase Cron candidate only after verification and separate automation authorization. No unattended automation in beta A.

Calendar sync: per-calendar cursor, source IDs, ETags, pagination, tombstones, sync-token 410 recovery. Do not combine incompatible bounded date filters with incremental tokens. Recurrence instances reconciled by provider identity. Existing calendars read-only in application logic. Provider-confirmed writes only; conditional If-Match, reconcile 412 and ambiguous outcomes. Sources: https://developers.google.com/workspace/calendar/api/guides/sync and https://developers.google.com/workspace/calendar/api/guides/version-resources

## Gates and limits

A: clearly labeled synthetic data only, authentication, persistent core, previews. B: separately authorized real read integrations/imports after security, restore and mappings tested. C: separately authorized dedicated calendar and live writes. D: separately authorized daily activation. Initial beta cannot promise precise closed-app notifications, push guarantees, always-on workers, continuous sync, automatic off-site backups, or p75 targets before measurement.

## Recovery

Version SQL migrations. Export schema/data/roles with Supabase CLI/pg_dump to user-selected encrypted off-site storage; never commit exports or keys. Separately retain auth settings and secret recovery instructions. Restore into isolated database, verify counts, foreign keys, ownership/RLS and workflow. Local PostgreSQL-compatible tests do not establish hosted Auth recovery. Hosted restore rehearsal must pass before real imports.

## Environment

Node 24 available. Docker executable exists but daemon socket access denied; do not claim Supabase local-stack verification. Use PGlite PostgreSQL engine for migration, RLS and logical recovery tests, with mocked Supabase auth roles; hosted GoTrue/PostgREST verification remains a distinct prerequisite. No hosted credentials configured.

## Vancouver timezone update

B.C. adopted permanent daylight time in 2026. Runtime tzdata currently resolves America/Vancouver to UTC-07 year-round after March 2026. Never hardcode UTC-08 winter assumptions. Test historical DST transitions and current dates; verify deployment and browser timezone data. Official guidance: https://www2.gov.bc.ca/gov/content/governments/celebrating-british-columbia/daylight-saving-time
