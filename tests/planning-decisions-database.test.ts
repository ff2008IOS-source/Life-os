import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
let db: PGlite;
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  block = "33333333-3333-4333-8333-333333333333";
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
}, 30000);
afterAll(async () => {
  await db.close();
});
it("permits one active decision per owned block across independent source updates", async () => {
  await db.query(
    "insert into integration_jobs(user_id,job_type,idempotency_key,payload,status)values($1,'work_replan_proposal','source-one',$2,'pending')",
    [
      owner,
      JSON.stringify({
        block_id: block,
        title: "Original title",
        deadline: "2026-11-12",
      }),
    ],
  );
  await expect(
    db.query(
      "insert into integration_jobs(user_id,job_type,idempotency_key,payload,status)values($1,'missed_block_decision','different-source',$2,'pending')",
      [owner, JSON.stringify({ block_id: block })],
    ),
  ).rejects.toThrow(/unique|duplicate/i);
  await db.query(
    "update integration_jobs set status='completed' where user_id=$1 and idempotency_key='source-one'",
    [owner],
  );
  await db.query(
    "insert into integration_jobs(user_id,job_type,idempotency_key,payload,status)values($1,'missed_block_decision','new-occurrence',$2,'pending')",
    [owner, JSON.stringify({ block_id: block })],
  );
  const history = await db.query<{ payload: { title: string } }>(
    "select payload from integration_jobs where idempotency_key='source-one'",
  );
  expect(history.rows[0].payload.title).toBe("Original title");
});
it("does not expose another owner’s decisions or grant client ledger writes", async () => {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    other,
  ]);
  await db.exec("set role authenticated");
  try {
    expect(
      (await db.query("select * from integration_jobs")).rows,
    ).toHaveLength(0);
    await expect(
      db.query("update integration_jobs set status='completed'"),
    ).rejects.toThrow(/permission|security/i);
  } finally {
    await db.exec("reset role");
  }
});
