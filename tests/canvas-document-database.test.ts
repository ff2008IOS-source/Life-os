import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
let generation: string;
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
  generation = (
    await db.query<{ generation: string }>(
      "insert into canvas_connections(user_id,token_ciphertext,token_iv,expires_at)values($1,'synthetic','synthetic',now()+interval '1 day')returning generation",
      [owner],
    )
  ).rows[0].generation;
  await db.query(
    "insert into canvas_records(user_id,resource_type,canvas_id,course_canvas_id,payload)values($1,'file','55:7','55',$2::jsonb)",
    [
      owner,
      JSON.stringify({
        id: 7,
        display_name: "[TEST] Syllabus.pdf",
        "content-type": "application/pdf",
        size: 100,
        updated_at: "2099-01-01",
      }),
    ],
  );
});
afterAll(async () => {
  await db.close();
});
it("seeds stable file identities idempotently and serializes document work", async () => {
  await db.query("select canvas_seed_documents($1)", [owner]);
  await db.query("select canvas_seed_documents($1)", [owner]);
  expect(
    (await db.query("select count(*)::int n from canvas_documents")).rows[0],
  ).toEqual({ n: 1 });
  expect(
    (
      await db.query("select canvas_claim_document($1,'999','7',$2)d", [
        owner,
        randomUUID(),
      ])
    ).rows[0],
  ).toEqual({ d: null });
  const lease = randomUUID();
  const first = (
    await db.query<{ d: { source_version: string } }>(
      "select canvas_claim_document($1,null,null,$2)d",
      [owner, lease],
    )
  ).rows[0].d;
  expect(first.source_version).toBeTruthy();
  expect(
    (
      await db.query("select canvas_claim_document($1,null,null,$2)d", [
        owner,
        randomUUID(),
      ])
    ).rows[0],
  ).toEqual({ d: null });
  await db.query(
    "update canvas_documents set lease_token=null,lease_until=null",
  );
});
it("stores actual extracted text atomically, searches with owner isolation and does not duplicate chunks", async () => {
  const lease = randomUUID();
  const d = (
    await db.query<{ d: { source_version: string } }>(
      "select canvas_claim_document($1,null,null,$2)d",
      [owner, lease],
    )
  ).rows[0].d;
  const meta = (
    await db.query<{ payload: unknown }>("select payload from canvas_records")
  ).rows[0].payload;
  await db.query(
    "select canvas_finish_document($1,'55','7',$2,$3,$4,$5::jsonb,'synthetic-hash',1,false,$6::jsonb)",
    [
      owner,
      lease,
      generation,
      d.source_version,
      JSON.stringify(meta),
      JSON.stringify([
        {
          index: 0,
          page: 1,
          text: "[TEST] Exam two covers GDP and inflation.",
        },
      ]),
    ],
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
  expect(
    (await db.query("select * from canvas_search_materials('55','inflation')"))
      .rows,
  ).toHaveLength(1);
  await expect(
    db.query("delete from canvas_document_chunks"),
  ).rejects.toMatchObject({ code: "42501" });
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    other,
  ]);
  expect(
    (await db.query("select * from canvas_search_materials('55','inflation')"))
      .rows,
  ).toHaveLength(0);
  await db.exec("reset role");
});
it("requeues changed content or rotated tokens while preserving historical extracted text", async () => {
  await db.query(
    'update canvas_records set payload=payload||\'{"updated_at":"2099-01-02"}\'',
  );
  await db.query("select canvas_seed_documents($1)", [owner]);
  expect(
    (await db.query("select state from canvas_documents")).rows[0],
  ).toEqual({ state: "pending" });
  expect(
    (await db.query("select count(*)::int n from canvas_document_chunks"))
      .rows[0],
  ).toEqual({ n: 1 });
  await db.query("update canvas_documents set state='unavailable'");
  await db.query("update canvas_connections set generation=gen_random_uuid()");
  await db.query("select canvas_seed_documents($1)", [owner]);
  expect(
    (await db.query("select state from canvas_documents")).rows[0],
  ).toEqual({ state: "pending" });
});
