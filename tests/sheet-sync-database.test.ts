import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
const user = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
let db: PGlite, source: string, mapping: string, project: string;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync("tests/auth-fixture.sql", "utf8"));
  await db.query("insert into auth.users values($1),($2)", [user, other]);
  for (const f of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
  await db.query("insert into private.approved_users values($1),($2)", [
    user,
    other,
  ]);
  const connection = (
    await db.query<{ id: string }>(
      "insert into calendar_connections(user_id,provider,provider_account_id)values($1,'google','[TEST]')returning id",
      [user],
    )
  ).rows[0].id;
  source = (
    await db.query<{ id: string }>(
      "insert into sheet_sync_sources(user_id,connection_id,spreadsheet_id,title)values($1,$2,'syntheticSheet001','[TEST]')returning id",
      [user, connection],
    )
  ).rows[0].id;
  project = (
    await db.query<{ id: string }>(
      "insert into projects(user_id,name,description)values($1,'[TEST] Project','[TEST] notes preserved')returning id",
      [user],
    )
  ).rows[0].id;
  mapping = (
    await db.query<{ id: string }>(
      `insert into sheet_sync_mappings(user_id,source_id,sheet_id,external_id,id_column,status_column,project_id,remote_values,baseline,remote_value)values($1,$2,7,'stable-a','ID','Status',$3,'{"active":"Active","paused":"Paused","completed":"Complete","cancelled":"Cancelled"}','active','Active')returning id`,
      [user, source, project],
    )
  ).rows[0].id;
});
afterAll(async () => {
  await db.close();
});
async function incoming(
  status: string | null,
  value: string | null,
  confirm = false,
  missing = false,
  formula = false,
  owner = user,
  stale = false,
) {
  const m = (
    await db.query<{ version: number }>(
      "select version from sheet_sync_mappings where id=$1",
      [mapping],
    )
  ).rows[0];
  const p = (
    await db.query<{ version: number }>(
      "select version from projects where id=$1",
      [project],
    )
  ).rows[0];
  return db.query("select accept_sheet_status($1,$2,$3,$4,$5,$6,2,$7,$8,$9)s", [
    owner,
    mapping,
    m.version,
    p.version + (stale ? 1 : 0),
    status,
    value,
    formula,
    missing,
    confirm,
  ]);
}
it("starts read-only, denies write-mode activation without verified owner/provider guards and prevents duplicates", async () => {
  expect(
    (await db.query("select mode from sheet_sync_sources")).rows[0],
  ).toEqual({ mode: "import_only" });
  await expect(
    db.query("update sheet_sync_sources set mode='two_way'where id=$1", [
      source,
    ]),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    db.query(
      "insert into sheet_sync_mappings select * from sheet_sync_mappings",
    ),
  ).rejects.toMatchObject({ code: "23505" });
});
it("applies nonconflicting incoming status without losing notes or queuing an echo", async () => {
  expect((await incoming("paused", "Paused")).rows[0]).toEqual({ s: "synced" });
  expect(
    (
      await db.query("select status,description from projects where id=$1", [
        project,
      ])
    ).rows[0],
  ).toEqual({ status: "paused", description: "[TEST] notes preserved" });
  expect(
    (await db.query("select count(*)::int n from sheet_sync_outbox")).rows[0],
  ).toEqual({ n: 0 });
});
it("preserves local edits and requires review for divergent changes, with optimistic version protection", async () => {
  await db.query("update projects set status='active'where id=$1", [project]);
  expect((await incoming("paused", "Paused")).rows[0]).toEqual({
    s: "local_preserved",
  });
  expect((await incoming("completed", "Complete")).rows[0]).toEqual({
    s: "conflict",
  });
  expect(
    (await db.query("select status from projects where id=$1", [project]))
      .rows[0],
  ).toEqual({ status: "active" });
  await expect(
    incoming("completed", "Complete", true, false, false, user, true),
  ).rejects.toMatchObject({ code: "40001" });
  expect((await incoming("completed", "Complete", true)).rows[0]).toEqual({
    s: "synced",
  });
});
it("keeps missing/formula source records for review and enforces ownership", async () => {
  expect((await incoming(null, null, false, true)).rows[0]).toEqual({
    s: "conflict",
  });
  expect(
    (await incoming("active", "Active", false, false, true)).rows[0],
  ).toEqual({ s: "conflict" });
  expect(
    (await db.query("select count(*)::int n from projects")).rows[0],
  ).toEqual({ n: 1 });
  await expect(
    incoming("active", "Active", false, false, false, other),
  ).rejects.toMatchObject({ code: "42501" });
  await db.exec("set role authenticated");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      other,
    ]);
    expect(
      (await db.query("select * from sheet_sync_sources")).rows,
    ).toHaveLength(0);
    await expect(
      db.query("update sheet_sync_sources set mode='two_way'"),
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await db.exec("reset role");
  }
});
it("atomically enqueues local changes only after explicit synthetic activation and prevents an inbound loop", async () => {
  await incoming("completed", "Complete", true);
  await db.query(
    "update sheet_sync_sources set write_authorized_at=now(),conditional_write_verified_at=now(),mode='two_way'where id=$1",
    [source],
  );
  await db.query("update projects set status='paused'where id=$1", [project]);
  expect(
    (await db.query("select intended_status,status from sheet_sync_outbox"))
      .rows[0],
  ).toEqual({ intended_status: "paused", status: "pending" });
  expect((await incoming("paused", "Paused")).rows[0]).toEqual({ s: "synced" });
  expect(
    (await db.query("select count(*)::int n from sheet_sync_outbox")).rows[0],
  ).toEqual({ n: 1 });
  expect(
    (await db.query("select status from sheet_sync_outbox")).rows[0],
  ).toEqual({ status: "confirmed" });
});
