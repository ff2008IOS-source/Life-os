import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
let db: PGlite, review: string, conversation: string;
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
  review = (
    await db.query<{ id: string }>(
      "insert into reviews(user_id,period_start,period_end,achievements) values($1,'2026-11-02','2026-11-08','Original owner notes')returning id",
      [owner],
    )
  ).rows[0].id;
});
afterAll(async () => {
  await db.close();
});
it("creates one durable conversation per owned review and rejects foreign ownership", async () => {
  await db.exec("set role service_role");
  conversation = (
    await db.query<{ id: string }>("select ensure_review_chat($1,$2)id", [
      owner,
      review,
    ])
  ).rows[0].id;
  expect(
    (
      await db.query<{ id: string }>("select ensure_review_chat($1,$2)id", [
        owner,
        review,
      ])
    ).rows[0].id,
  ).toBe(conversation);
  expect((await db.query("select * from review_chat_links")).rows).toHaveLength(
    1,
  );
  await expect(
    db.query("select ensure_review_chat($1,$2)", [other, review]),
  ).rejects.toMatchObject({ code: "42501" });
});
it("exposes only owned links and prevents direct client writes and RPC execution", async () => {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
  expect((await db.query("select * from review_chat_links")).rows).toHaveLength(
    1,
  );
  await expect(
    db.query("select ensure_review_chat($1,$2)", [owner, review]),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(db.query("delete from review_chat_links")).rejects.toMatchObject(
    { code: "42501" },
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    other,
  ]);
  expect((await db.query("select * from review_chat_links")).rows).toHaveLength(
    0,
  );
});
it("preserves original notes and requires owner-consistent foreign keys", async () => {
  await db.exec("reset role");
  await db.query(
    "update reviews set conversation_summary='Owner reviewed reflection' where id=$1",
    [review],
  );
  expect(
    (
      await db.query<{ achievements: string }>(
        "select achievements from reviews where id=$1",
        [review],
      )
    ).rows[0].achievements,
  ).toBe("Original owner notes");
  await expect(
    db.query("insert into review_chat_links values($1,$2,$3)", [
      other,
      review,
      conversation,
    ]),
  ).rejects.toMatchObject({ code: "23503" });
});
