import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222",
  later = "33333333-3333-4333-8333-333333333333";
const H = "a".repeat(64),
  OTHER = "b".repeat(64);
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
    `insert into private.approved_users values('${a}'),('${b}');
     insert into tasks(user_id,title) values('${a}','[TEST] Private');
     insert into auth.mfa_factors(user_id,status,factor_type) values('${a}','verified','totp');
     insert into auth.sessions values('${later}','${a}');`,
  );
});
afterAll(async () => {
  await db.close();
});
async function as<T>(user: string, aal: string, session: string, sql: string) {
  await db.exec("set role authenticated");
  try {
    await db.query(
      "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.aal',$2,false),set_config('request.jwt.claim.session_id',$3,false)",
      [user, aal, session],
    );
    return (await db.query<T>(sql)).rows;
  } finally {
    await db.exec("reset role");
  }
}
const tasks = (user: string, aal: string, session: string) =>
  as(user, aal, session, "select title from tasks");

describe("remember this device for 14 days", () => {
  it("can only be set from a session that passed the code", async () => {
    await expect(
      as(a, "aal1", a, `select public.remember_this_device('${H}')`),
    ).rejects.toMatchObject({ code: "42501" });
    const [row] = await as<{ until: string }>(
      a,
      "aal2",
      a,
      `select public.remember_this_device('${H}') as until`,
    );
    const days = (Date.parse(row.until) - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
  });
  it("lets a later password-only session in with the device token, and only with it", async () => {
    expect(await tasks(a, "aal1", later)).toHaveLength(0);
    expect(
      await as(
        a,
        "aal1",
        later,
        `select public.trust_this_session('${OTHER}') as v`,
      ),
    ).toEqual([{ v: null }]);
    expect(await tasks(a, "aal1", later)).toHaveLength(0);
    // Another account can't use the owner's token.
    expect(
      await as(b, "aal1", b, `select public.trust_this_session('${H}') as v`),
    ).toEqual([{ v: null }]);
    await as(a, "aal1", later, `select public.trust_this_session('${H}')`);
    expect(await tasks(a, "aal1", later)).toHaveLength(1);
  });
  it("keeps device records out of reach of the browser", async () => {
    await expect(
      as(a, "aal2", a, "select * from private.trusted_devices"),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("stops after 14 days and when devices are forgotten", async () => {
    await db.exec(
      "update private.trusted_devices set expires_at = now() - interval '1 second'",
    );
    expect(await tasks(a, "aal1", later)).toHaveLength(0);
    await db.exec(
      "update private.trusted_devices set expires_at = now() + interval '1 day'",
    );
    expect(await tasks(a, "aal1", later)).toHaveLength(1);
    expect(
      await as(
        a,
        "aal1",
        later,
        "select public.forget_remembered_devices() as n",
      ),
    ).toEqual([{ n: 1 }]);
    expect(await tasks(a, "aal1", later)).toHaveLength(0);
  });
});
