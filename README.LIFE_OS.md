# Life OS

Your life, organized in one place. Private single-user application; Next.js App Router, strict TypeScript, Tailwind, Supabase PostgreSQL/Auth. No paid AI or analytics.

## Current state

Local application and synthetic tests; **not deployed, not connected to personal services, not approved for real data or daily use**. See [progress](docs/PROGRESS.md), [feasibility](docs/FEASIBILITY.md), and [recovery](docs/RECOVERY.md). Finance/Wellbeing start empty. No grades, deadlines or commitments are inferred from the specification.

## Run locally

Node >=22 (tested Node 24). `npm ci`, copy `.env.example` to `.env.local`, then `npm run dev`. Without credentials, private pages redirect to a setup screen; tasks never fall back to browser storage. Dependencies are locked in package-lock.json.

### Supabase Free setup

1. Create/use an owner-controlled Free project; do not enable a paid plan. Select a suitable region after reviewing privacy needs. This has not been provisioned by the build agent.
2. Disable public account signups in Auth settings. Provision the approved test account from the dashboard with a strong password. Enable appropriate Supabase Auth abuse protections. Configure localhost and eventual Vercel URL in Auth settings. Use synthetic identity/data for beta testing.
3. Apply every SQL file in `supabase/migrations` in filename order with the Supabase CLI or trusted SQL editor. Migrations are tested locally against PostgreSQL via PGlite, including RLS on every private table. Hosted migration/Auth/PostgREST behavior still needs verification.
4. As the database owner, insert the approved test user's UUID into `private.approved_users` (parameterized SQL or trusted SQL editor). This table is inaccessible to browser clients. Approval is enforced by RLS as well as the server.
5. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and server-only `LIFE_OS_ALLOWED_EMAIL` and `LIFE_OS_APP_ORIGIN` (exact browser origin, e.g. `http://localhost:3000`, without a trailing slash). The publishable key is public by design; never use a service-role key here. Do not commit `.env.local`.
6. Sign in and initialize the workspace from Home. Settings → Add [TEST] examples creates only labeled synthetic records; repeated runs do not duplicate them.
7. Verify hosted ownership, refresh/sign-in persistence and backup restoration before requesting Stage B.

MFA enrollment UI and recovery are not implemented yet. Do not treat beta authentication as fully hardened until hosted Auth, rate limits, MFA/recovery and security checks are completed.

## Checks

- `npm run typecheck`
- `npm run lint`
- `npm test` — domain, deterministic scheduler, PostgreSQL migrations/RLS/integrity
- `npm run build`
- `npm run test:e2e` — build first; uses system Chromium at `/usr/bin/chromium` (override config on other machines). Starts a **test-only loopback Supabase-protocol adapter** backed by PGlite plus the Next production server. Synthetic credentials exist only in tests. This is not hosted Supabase Auth/PostgREST verification and never changes production authentication code.

Database tests use a mocked auth schema and real PostgreSQL execution through PGlite because Docker daemon access is unavailable in the development environment. The test adapter is not shipped as an application route. Production requests always require a valid Supabase identity and database approval.

## Architecture

- `src/app`: protected pages and versioned route handlers
- `src/components`: responsive UI and accessible Radix dialogs/shadcn-style Button
- `src/lib/services`: database-backed workspace services
- `src/lib/schemas.ts`: shared strict input contracts and domain models
- `src/lib/scheduler.ts`: deterministic non-writing preview engine
- `supabase/migrations`: source-controlled schema, RLS and synthetic beta fixtures
- `tests`: automated unit/database/browser checks

Server-side validation, request-origin checks, per-user RLS, composite ownership foreign keys, optimistic record versions and append-only audit logs protect core edits. Default database privileges are explicitly revoked before application grants. No service-role client is used for normal requests. Tokens are never returned in workspace/export payloads.

The workspace loader fetches stable 500-row pages, with an explicit beta guard below 10,000 records per collection; it fails rather than reporting truncated metrics. Paginated entity list endpoints provide 50-row pages; incremental workspace pagination remains work before larger daily-use datasets. Export paginates but is not a transactionally consistent snapshot.

## Scheduling

Per-task/project opt-in, Academics/Career/Projects only. 9 AM–9 PM Vancouver, every day; <=240 minutes/day; 25–90 minute sessions, >=10 minute breaks, >=60 minute freeze, seven-day horizon, preferred 24-hour deadline buffer. Previews accept synthetic busy intervals and do not save blocks or create events. Existing-block support is tested in the engine; production Calendar data is not connected. Infeasible work has explicit warnings. Remaining effort subtracts actual/completed effort without double-counting and existing reservations. Live apply and unattended workers are not enabled or implemented as callable routes.

## Deployment and approval gates

Use Vercel Hobby and Supabase Free only, with free Vercel subdomain. Set environment variables in Vercel; redeploy after public variable changes. No Vercel/Supabase credentials are available in this workspace, so no hosted resources or deployments have been created.

Stage A: test records only. Stage B: separately approved read integrations/imports after security, restore and mapping verification. Stage C: separately approved Life OS calendar creation and writes. Stage D: separately approved daily activation. Never create or alter the six existing calendars. No automatic background execution or push-delivery guarantee. See official-source limits in feasibility report.
