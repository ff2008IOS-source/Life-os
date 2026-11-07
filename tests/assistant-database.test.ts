import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  request = "33333333-3333-4333-8333-333333333333";
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
it("requires explicit Free-plan activation, claims once, and enforces rate limits", async () => {
  await expect(
    db.query("select claim_assistant_request($1,null,null,'Question')", [
      request,
    ]),
  ).rejects.toMatchObject({ code: "42501" });
  await db.query("select set_my_assistant(true,true,1)");
  const first = (
    await db.query<{ result: { conversation_id: string; replayed: boolean } }>(
      "select claim_assistant_request($1,null,null,'Question')result",
      [request],
    )
  ).rows[0].result;
  expect(first.replayed).toBe(false);
  const replay = (
    await db.query<{ result: { conversation_id: string; replayed: boolean } }>(
      "select claim_assistant_request($1,null,null,'Question')result",
      [request],
    )
  ).rows[0].result;
  expect(replay).toMatchObject({
    replayed: true,
    conversation_id: first.conversation_id,
  });
  await expect(
    db.query("select claim_assistant_request($1,null,null,'Changed')", [
      request,
    ]),
  ).rejects.toMatchObject({ code: "40001" });
  await expect(
    db.query(
      "select claim_assistant_request(gen_random_uuid(),null,null,'Another')",
    ),
  ).rejects.toMatchObject({ code: "P0001" });
  expect(
    (
      await db.query<{ requests: number }>(
        "select requests from assistant_usage",
      )
    ).rows[0].requests,
  ).toBe(1);
});
it("isolates conversations and prevents direct client writes", async () => {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    other,
  ]);
  expect(
    (await db.query("select * from assistant_conversations")).rows,
  ).toHaveLength(0);
  await expect(
    db.query("insert into assistant_settings(user_id)values($1)", [other]),
  ).rejects.toMatchObject({ code: "42501" });
  await db.query("select set_my_assistant(true,true,10)");
  await expect(
    db.query("select claim_assistant_request($1,null,null,'Question')", [
      request,
    ]),
  ).rejects.toMatchObject({ code: "40001" });
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
});
it("conversation deletion removes content but cannot reset the reserved daily allowance", async () => {
  await db.query("delete from assistant_conversations");
  expect(
    (await db.query("select * from assistant_exchanges")).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query<{ requests: number }>(
        "select requests from assistant_usage",
      )
    ).rows[0].requests,
  ).toBe(1);
  await db.exec("reset role");
  await db.query(
    "update assistant_settings set last_request_at=now()-interval '2 minutes'where user_id=$1",
    [owner],
  );
  await db.exec("set role authenticated");
  await expect(
    db.query(
      "select claim_assistant_request(gen_random_uuid(),null,null,'Quota bypass')",
    ),
  ).rejects.toMatchObject({ code: "P0001" });
});
