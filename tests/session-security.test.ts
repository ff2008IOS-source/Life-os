import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync("tests/auth-fixture.sql", "utf8"));
  await db.exec(`insert into auth.users values('${a}'),('${b}');`);
  for (const file of readdirSync("supabase/migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync("supabase/migrations/" + file, "utf8"));
  await db.exec(
    `insert into private.approved_users values('${a}'),('${b}');insert into tasks(user_id,title) values('${a}','[TEST] Private');`,
  );
});
afterAll(async () => {
  await db.close();
});
async function read(user: string, aal = "aal1", session = user) {
  await db.exec("set role authenticated");
  try {
    await db.query(
      "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.aal',$2,false),set_config('request.jwt.claim.session_id',$3,false)",
      [user, aal, session],
    );
    return (await db.query("select title from tasks")).rows;
  } finally {
    await db.exec("reset role");
  }
}
describe("session and MFA database enforcement", () => {
  it("allows the approved owner and denies other users and mismatched sessions", async () => {
    expect(await read(a)).toHaveLength(1);
    expect(await read(b)).toHaveLength(0);
    expect(await read(a, "aal1", b)).toHaveLength(0);
  });
  it("requires AAL2 as soon as a verified factor exists", async () => {
    await db.exec(
      `insert into auth.mfa_factors(user_id,status,factor_type) values('${a}','verified','totp')`,
    );
    expect(await read(a, "aal1")).toHaveLength(0);
    expect(await read(a, "aal2")).toHaveLength(1);
  });
  it("denies a revoked session even with an AAL2 JWT claim", async () => {
    await db.exec(`delete from auth.sessions where user_id='${a}'`);
    expect(await read(a, "aal2")).toHaveLength(0);
  });
});
describe("privileged operations stay server-only", () => {
  it("denies client access to device credentials, locks, imports and worker configuration", async () => {
    await db.exec("set role authenticated");
    try {
      for (const table of [
        "push_subscriptions",
        "notification_delivery_attempts",
        "calendar_write_locks",
      ])
        await expect(
          db.query(`select * from public.${table}`),
        ).rejects.toMatchObject({ code: "42501" });
      for (const sql of [
        `select public.claim_calendar_write('${a}','33333333-3333-4333-8333-333333333333')`,
        `select public.configure_notification_timer('not-a-secret')`,
        `select public.apply_career_import('${a}','33333333-3333-4333-8333-333333333333')`,
      ])
        await expect(db.query(sql)).rejects.toMatchObject({ code: "42501" });
    } finally {
      await db.exec("reset role");
    }
  });
  it("serializes calendar mutations and does not claim a delivered notification twice", async () => {
    await db.exec("set role service_role");
    try {
      expect(
        (
          await db.query<{ claimed: boolean }>(
            `select public.claim_calendar_write('${b}','33333333-3333-4333-8333-333333333333') as claimed`,
          )
        ).rows[0].claimed,
      ).toBe(true);
      expect(
        (
          await db.query<{ claimed: boolean }>(
            `select public.claim_calendar_write('${b}','44444444-4444-4444-8444-444444444444') as claimed`,
          )
        ).rows[0].claimed,
      ).toBe(false);
    } finally {
      await db.exec("reset role");
    }
    const n = (
      await db.query<{ id: string }>(
        "insert into notifications(user_id,category,title,deduplication_key) values($1,'deadlines','[TEST] Reminder','synthetic') returning id",
        [b],
      )
    ).rows[0].id;
    const s = (
      await db.query<{ id: string }>(
        "insert into push_subscriptions(user_id,endpoint,keys) values($1,'https://web.push.apple.com/synthetic','{}') returning id",
        [b],
      )
    ).rows[0].id;
    const attempt = (
      await db.query<{ id: string }>(
        "insert into notification_delivery_attempts(user_id,notification_id,subscription_id) values($1,$2,$3) returning id",
        [b, n, s],
      )
    ).rows[0].id;
    expect(
      (
        await db.query<{ claimed: boolean }>(
          "select claim_notification_delivery($1) as claimed",
          [attempt],
        )
      ).rows[0].claimed,
    ).toBe(true);
    expect(
      (
        await db.query<{ claimed: boolean }>(
          "select claim_notification_delivery($1) as claimed",
          [attempt],
        )
      ).rows[0].claimed,
    ).toBe(false);
    await db.query(
      "update notification_delivery_attempts set status='delivered' where id=$1",
      [attempt],
    );
    expect(
      (
        await db.query<{ claimed: boolean }>(
          "select claim_notification_delivery($1) as claimed",
          [attempt],
        )
      ).rows[0].claimed,
    ).toBe(false);
  });
  it("can purge synthetic account-owned data without leaving credentials or jobs", async () => {
    await db.query("delete from auth.users where id=$1", [b]);
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from push_subscriptions where user_id=$1",
          [b],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from calendar_write_locks where user_id=$1",
          [b],
        )
      ).rows[0].n,
    ).toBe(0);
  });
});
