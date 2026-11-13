import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync("tests/auth-fixture.sql", "utf8"));
  await db.query("insert into auth.users values($1),($2)", [owner, other]);
  for (const f of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
  await db.query("insert into private.approved_users values($1),($2)", [
    owner,
    other,
  ]);
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
});
afterAll(async () => {
  await db.close();
});
it("saves a check-in once per owner/date, updates versions and enforces cross-user isolation", async () => {
  await db.query(
    "insert into daily_check_ins(user_id,day,accomplishments)values($1,'2026-11-12','Recorded work')",
    [owner],
  );
  await expect(
    db.query(
      "insert into daily_check_ins(user_id,day)values($1,'2026-11-12')",
      [owner],
    ),
  ).rejects.toMatchObject({ code: "23505" });
  await db.query(
    "update daily_check_ins set status='completed' where user_id=$1 and day='2026-11-12'and version=1",
    [owner],
  );
  expect(
    (await db.query<{ version: number }>("select version from daily_check_ins"))
      .rows[0].version,
  ).toBe(2);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    other,
  ]);
  expect((await db.query("select * from daily_check_ins")).rows).toHaveLength(
    0,
  );
  await expect(
    db.query(
      "insert into daily_check_ins(user_id,day)values($1,'2026-11-13')",
      [owner],
    ),
  ).rejects.toMatchObject({ code: "42501" });
});
it("prevents foreign-owner task links and rejects anonymous reads", async () => {
  await db.exec("reset role");
  const t = (
    await db.query<{ id: string }>(
      "insert into tasks(user_id,title)values($1,'Other owner task')returning id",
      [other],
    )
  ).rows[0].id;
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
  await expect(
    db.query("update daily_check_ins set task_id=$1 where user_id=$2", [
      t,
      owner,
    ]),
  ).rejects.toMatchObject({ code: "23503" });
  await db.exec("set role anon");
  for (const table of [
    "daily_check_ins",
    "briefing_settings",
    "briefing_actions",
  ])
    await expect(db.query(`select * from ${table}`)).rejects.toMatchObject({
      code: "42501",
    });
});
