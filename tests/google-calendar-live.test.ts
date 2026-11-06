import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import {
  createOAuthAttempt,
  verifyOAuthAttempt,
  authorizationUrl,
  requireReadScopes,
  CALENDAR_SCOPES,
} from "@/lib/integrations/google-oauth";
import {
  collectWindowEvents,
  exchangeGoogleCode,
} from "@/lib/integrations/google-server";
import {
  eventOnDate,
  type CalendarEvent,
} from "@/lib/integrations/calendar-view";
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
let connection: string, calendar: string;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create role service_role; create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${a}'),('${b}');create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
  );
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync("supabase/migrations/" + file, "utf8"));
  await db.exec(`insert into private.approved_users values('${a}');`);
});
afterAll(async () => {
  await db.close();
});
async function rpc<T>(name: string, args: unknown[]): Promise<T> {
  await db.exec("set role service_role");
  try {
    const r = await db.query<{ value: T }>(
      `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as value`,
      args,
    );
    return r.rows[0].value;
  } finally {
    await db.exec("reset role");
  }
}
const event = {
  provider_event_id: "instance",
  provider_ical_uid: "series",
  title: "[TEST] Recurring instance",
  start_at: "2026-11-06T16:00:00Z",
  end_at: "2026-11-06T17:00:00Z",
  all_day_start: null,
  all_day_end: null,
  timezone: "America/Vancouver",
  busy_status: "busy",
  event_status: "confirmed",
  etag: "v1",
  provider_updated_at: "2026-11-06T15:00:00Z",
  raw_metadata: { recurring_event_id: "series" },
};
async function finish(lease: string, events: unknown[]) {
  return rpc("google_finish_sync", [
    a,
    calendar,
    lease,
    "2026-10-01T00:00Z",
    "2027-02-01T00:00Z",
    JSON.stringify(events),
  ]);
}
describe("read-only Google connection security", () => {
  it("reports rejected OAuth client credentials without exposing the provider body", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", " synthetic.apps.googleusercontent.com ");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", " synthetic-secret ");
    vi.stubEnv("LIFE_OS_APP_ORIGIN", "https://example.invalid");
    vi.stubEnv(
      "LIFE_OS_CREDENTIAL_KEY",
      Buffer.alloc(32, 3).toString("base64"),
    );
    vi.stubEnv("SUPABASE_SECRET_KEY", "synthetic-server-key");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    const fake = vi.fn(async (_url: unknown, options?: RequestInit) => {
      const body = options?.body as URLSearchParams;
      expect(body.get("client_id")).toBe(
        "synthetic.apps.googleusercontent.com",
      );
      expect(body.get("client_secret")).toBe("synthetic-secret");
      return Response.json(
        {
          error: "invalid_client",
          error_description:
            "Do not display provider details or synthetic-secret",
        },
        { status: 401 },
      );
    });
    vi.stubGlobal("fetch", fake);
    try {
      await expect(
        exchangeGoogleCode("synthetic-code", "synthetic-verifier"),
      ).rejects.toMatchObject({ code: "GOOGLE_INVALID_CLIENT", status: 502 });
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("binds OAuth state to the user, expiry and encrypted cookie; requests no writes", () => {
    const key = Buffer.alloc(32, 3);
    const attempt = createOAuthAttempt(a, key, 1000);
    expect(
      verifyOAuthAttempt(attempt.cookie, attempt.state, a, key, 2000),
    ).toBe(attempt.verifier);
    expect(() =>
      verifyOAuthAttempt(attempt.cookie, "forged", a, key, 2000),
    ).toThrow();
    expect(() =>
      verifyOAuthAttempt(attempt.cookie, attempt.state, b, key, 2000),
    ).toThrow();
    expect(() =>
      verifyOAuthAttempt(attempt.cookie, attempt.state, a, key, 602000),
    ).toThrow();
    const url = new URL(
      authorizationUrl(
        "client",
        "https://example.invalid",
        attempt.state,
        attempt.challenge,
      ),
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://example.invalid/api/v1/calendar/oauth/callback",
    );
    expect(url.searchParams.get("scope")).toBe(CALENDAR_SCOPES.join(" "));
    expect(CALENDAR_SCOPES.slice(2).every((s) => s.endsWith(".readonly"))).toBe(
      true,
    );
    expect(() => requireReadScopes("openid email")).toThrow();
  });
  it("collects every expanded page, deduplicates instances, and rejects failures before persistence", async () => {
    const calls: Record<string, string>[] = [];
    const provider = {
      id: "one",
      summary: "[TEST]",
      start: { date: "2026-11-06" },
      end: { date: "2026-11-07" },
    };
    const events = await collectWindowEvents(
      "synthetic",
      "source",
      "America/Vancouver",
      "2026-10-01T00:00Z",
      "2027-02-01T00:00Z",
      async (_path, _token, params = {}) => {
        calls.push(params);
        return params.pageToken
          ? { items: [{ ...provider, summary: "[TEST] Updated" }] }
          : { items: [provider], nextPageToken: "next" };
      },
    );
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("[TEST] Updated");
    expect(calls.every((c) => c.singleEvents === "true")).toBe(true);
    await expect(
      collectWindowEvents(
        "synthetic",
        "source",
        "America/Vancouver",
        "a",
        "b",
        async () => {
          throw Error("provider failed");
        },
      ),
    ).rejects.toThrow("provider failed");
  });
  it("uses exclusive all-day dates and Vancouver boundaries", () => {
    const e = {
      ...event,
      id: "event",
      calendar_id: "calendar",
      provider_event_id: "instance",
      busy_status: "busy",
    } as CalendarEvent;
    expect(eventOnDate(e, "2026-11-06")).toBe(true);
    expect(eventOnDate(e, "2026-11-05")).toBe(false);
    const allDay = {
      ...e,
      start_at: null,
      end_at: null,
      all_day_start: "2026-11-06",
      all_day_end: "2026-11-07",
    };
    expect(eventOnDate(allDay, "2026-11-06")).toBe(true);
    expect(eventOnDate(allDay, "2026-11-07")).toBe(false);
  });
  it("permits only the server role to invoke integration RPCs", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec("set role " + role);
      try {
        await expect(
          db.query("select public.google_get_credential($1,$2)", [a, a]),
        ).rejects.toThrow(/permission denied/);
      } finally {
        await db.exec("reset role");
      }
    }
    await expect(
      rpc("google_save_connection", [b, "google-other", "ciphertext"]),
    ).rejects.toThrow(/Unapproved/);
  });
  it("stores server-only encrypted envelopes; list refresh preserves read-only selection", async () => {
    connection = await rpc<string>("google_save_connection", [
      a,
      "google-account",
      "encrypted-synthetic-envelope",
    ]);
    expect(await rpc("google_get_credential", [a, connection])).toBe(
      "encrypted-synthetic-envelope",
    );
    await rpc("google_store_calendars", [
      a,
      connection,
      JSON.stringify([
        {
          id: "source",
          name: "[TEST] Calendar",
          timezone: "America/Vancouver",
          color: "#123456",
          access_role: "owner",
        },
      ]),
    ]);
    calendar = (await db.query<{ id: string }>("select id from calendars"))
      .rows[0].id;
    expect(
      (
        await db.query<{ write_enabled: boolean; sync_enabled: boolean }>(
          "select write_enabled,sync_enabled from calendars",
        )
      ).rows[0],
    ).toEqual({ write_enabled: false, sync_enabled: false });
    await rpc("google_select_calendar", [a, calendar, true]);
  });
  it("leases syncs, commits a full snapshot atomically, and updates changed events without duplicates", async () => {
    const lease = await rpc<string>("google_claim_sync", [a, calendar]);
    await expect(rpc("google_claim_sync", [a, calendar])).rejects.toThrow(
      /already running/,
    );
    await finish(lease, [event]);
    const next = await rpc<string>("google_claim_sync", [a, calendar]);
    await finish(next, [
      { ...event, title: "[TEST] External edit", etag: "v2" },
    ]);
    expect(
      (await db.query<{ title: string }>("select title from calendar_events"))
        .rows,
    ).toEqual([{ title: "[TEST] External edit" }]);
    expect(
      (
        await db.query<{ last_synced_at: string }>(
          "select last_synced_at from calendars",
        )
      ).rows[0].last_synced_at,
    ).toBeTruthy();
  });
  it("rolls back malformed snapshots and reconciles deleted remote instances", async () => {
    let lease = await rpc<string>("google_claim_sync", [a, calendar]);
    await expect(
      finish(lease, [{ ...event, end_at: "2026-11-05T00:00Z" }]),
    ).rejects.toThrow();
    expect(
      (
        await db.query<{ event_status: string }>(
          "select event_status from calendar_events",
        )
      ).rows[0].event_status,
    ).toBe("confirmed");
    await rpc("google_fail_sync", [
      a,
      calendar,
      lease,
      "Synthetic failure; cache retained",
    ]);
    lease = await rpc<string>("google_claim_sync", [a, calendar]);
    await finish(lease, []);
    expect(
      (
        await db.query<{ event_status: string }>(
          "select event_status from calendar_events",
        )
      ).rows[0].event_status,
    ).toBe("cancelled");
  });
  it("disconnect revokes local access, deletes credentials, and invalidates in-flight synchronization", async () => {
    const lease = await rpc<string>("google_claim_sync", [a, calendar]);
    await rpc("google_disconnect", [a, connection]);
    await expect(finish(lease, [event])).rejects.toThrow(/lease expired/);
    expect(await rpc("google_get_credential", [a, connection])).toBeNull();
    expect(
      (await db.query("select * from private.oauth_credentials")).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query<{ sync_enabled: boolean }>(
          "select sync_enabled from calendars",
        )
      ).rows[0].sync_enabled,
    ).toBe(false);
  });
});
