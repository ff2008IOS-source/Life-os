import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  lease = "33333333-3333-4333-8333-333333333333",
  row = "44444444-4444-4444-8444-444444444444",
  op = "55555555-5555-4555-8555-555555555555";
let db: PGlite, dataset: string;
const cell = (value: number, writable = true) => ({
  value,
  display: String(value),
  formula: null,
  source_writable: true,
  writable,
  allowed: null,
  error: null,
});
const snapshot = (version: number | null, made = 4) => [
  {
    id: row,
    external_key: "stable-test",
    key_values: ["test-player"],
    row_locator: 2,
    baseline: { made: cell(made) },
    remote_cells: { made: cell(made) },
    local_values: { made },
    conflicts: {},
    remote_hash: "test-hash",
    remote_missing: false,
    state: "synced",
    expected_version: version,
  },
];
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
  const connection = (
    await db.query<{ id: string }>(
      "insert into calendar_connections(user_id,provider,provider_account_id)values($1,'google','[TEST]')returning id",
      [owner],
    )
  ).rows[0].id;
  const source = (
    await db.query<{ id: string }>(
      "insert into data_sources(user_id,provider,source_key)values($1,'google_sheets','syntheticSheet001')returning id",
      [owner],
    )
  ).rows[0].id;
  const config = {
    header_row: 0,
    start_column: 0,
    allow_insert: true,
    allow_delete: true,
    columns: [
      { key: "made", header: "Made", writable: true },
      { key: "id", header: "ID", key_part: true, writable: false },
    ],
  };
  dataset = (
    await db.query<{ id: string }>(
      "insert into sheet_rest_datasets(user_id,connection_id,source_id,spreadsheet_id,worksheet_id,title,worksheet_title,config,test_only,outbound_enabled,mode)values($1,$2,$3,'syntheticSheet001',0,'[TEST]','[TEST]',$4::jsonb,true,true,'two_way')returning id",
      [owner, connection, source, JSON.stringify(config)],
    )
  ).rows[0].id;
});
afterAll(async () => {
  await db.close();
});
async function claim() {
  await db.query(
    "update sheet_rest_datasets set last_attempt_at=null,lease_until=null where id=$1",
    [dataset],
  );
  return db.query("select claim_sheet_rest($1,$2,$3)ok", [
    owner,
    dataset,
    lease,
  ]);
}
async function release() {
  await db.query(
    "update sheet_rest_datasets set lease_until=null,lease_token=null where id=$1",
    [dataset],
  );
}
async function ingest(rows: unknown[]) {
  return db.query("select ingest_sheet_rest($1,$2,$3,$4::jsonb,'test-hash')n", [
    owner,
    dataset,
    lease,
    JSON.stringify(rows),
  ]);
}
it("atomically imports stable records without duplicates or version churn on identical repeats", async () => {
  expect((await claim()).rows[0]).toEqual({ ok: true });
  expect((await ingest(snapshot(null))).rows[0]).toEqual({ n: 1 });
  expect((await ingest(snapshot(1))).rows[0]).toEqual({ n: 0 });
  expect(
    (
      await db.query(
        "select count(*)::int n,max(version)v from sheet_rest_rows",
      )
    ).rows[0],
  ).toEqual({ n: 1, v: 1 });
  await release();
});
it("rejects cross-owner access and browser mutations even with an approved different owner", async () => {
  await db.exec(
    `set role authenticated;select set_config('request.jwt.claim.sub','${other}',false)`,
  );
  expect((await db.query("select * from sheet_rest_rows")).rows).toEqual([]);
  await expect(
    db.query("update sheet_rest_rows set local_values='{}'"),
  ).rejects.toMatchObject({ code: "42501" });
  await db.exec("reset role");
  await expect(
    db.query(
      "select edit_sheet_rest($1,$2,$3,1,$4,'update','{\"made\":5}',null,null)",
      [other, dataset, row, op],
    ),
  ).rejects.toMatchObject({ code: "42501" });
});
it("queues an idempotent draft, requires explicit approval and guards concurrent edits", async () => {
  const args = [owner, dataset, row, op];
  expect(
    (
      await db.query(
        "select edit_sheet_rest($1,$2,$3,1,$4,'update','{\"made\":5}',null,null)id",
        args,
      )
    ).rows[0],
  ).toEqual({ id: op });
  expect(
    (
      await db.query(
        "select edit_sheet_rest($1,$2,$3,1,$4,'update','{\"made\":5}',null,null)id",
        args,
      )
    ).rows[0],
  ).toEqual({ id: op });
  expect(
    (
      await db.query(
        "select status,approved_at from sheet_rest_operations where id=$1",
        [op],
      )
    ).rows[0],
  ).toEqual({ status: "draft", approved_at: null });
  await expect(
    db.query(
      "select edit_sheet_rest($1,$2,$3,1,gen_random_uuid(),'update','{\"made\":8}',null,null)",
      [owner, dataset, row],
    ),
  ).rejects.toMatchObject({ code: "40001" });
  await claim();
  await expect(
    db.query("select approve_sheet_rest($1,$2,$3,1)", [owner, dataset, op]),
  ).rejects.toMatchObject({ code: "55P03" });
  await release();
  await db.query("select approve_sheet_rest($1,$2,$3,1)", [owner, dataset, op]);
  expect(
    (
      await db.query("select status from sheet_rest_operations where id=$1", [
        op,
      ])
    ).rows[0],
  ).toEqual({ status: "approved" });
});
it("records verified provider outcomes and audit evidence without deleting history", async () => {
  await claim();
  expect((await ingest(snapshot(2, 5))).rows[0]).toEqual({ n: 1 });
  await db.query("select finish_sheet_rest($1,$2,$3,$4,true)", [
    owner,
    dataset,
    op,
    lease,
  ]);
  expect(
    (
      await db.query(
        "select status,provider_accepted,verified_at is not null verified from sheet_rest_operations where id=$1",
        [op],
      )
    ).rows[0],
  ).toEqual({ status: "confirmed", provider_accepted: true, verified: true });
  expect(
    (
      await db.query(
        "select count(*)::int n from audit_logs where entity_type='sheet_rest_operations'",
      )
    ).rows[0],
  ).toEqual({ n: 2 });
  await release();
});
it("blocks identity edits, unactivated production writes and uncertain-operation replacement", async () => {
  await expect(
    db.query(
      "select edit_sheet_rest($1,$2,$3,3,gen_random_uuid(),'update','{\"id\":\"other\"}',null,null)",
      [owner, dataset, row],
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    db.query("update sheet_rest_datasets set test_only=false where id=$1", [
      dataset,
    ]),
  ).rejects.toMatchObject({ code: "23514" });
  await db.query(
    "update sheet_rest_operations set status='unknown'where id=$1",
    [op],
  );
  await expect(
    db.query(
      "select edit_sheet_rest($1,$2,$3,3,gen_random_uuid(),'update','{\"made\":8}',null,null)",
      [owner, dataset, row],
    ),
  ).rejects.toMatchObject({ code: "40001" });
});
it("enforces approved project links and makes project edits durable without requiring a second edit", async () => {
  // An isolated second table avoids earlier unknown-operation fixtures.
  const c = (
    await db.query<{ connection_id: string; source_id: string }>(
      "select connection_id,source_id from sheet_rest_datasets where id=$1",
      [dataset],
    )
  ).rows[0];
  const d = (
    await db.query<{ id: string }>(
      `insert into sheet_rest_datasets(user_id,connection_id,source_id,spreadsheet_id,worksheet_id,title,worksheet_title,config,test_only)values($1,$2,$3,'syntheticProjectSheet',1,'[TEST]','Test','{"columns":[{"key":"status","writable":true}]}',true)returning id`,
      [owner, c.connection_id, c.source_id],
    )
  ).rows[0].id;
  const r = (
    await db.query<{ id: string }>(
      `insert into sheet_rest_rows(user_id,dataset_id,external_key,key_values,local_values,baseline,remote_cells)values($1,$2,'test-project','["project"]','{"status":"active"}','{"status":{"value":"active","writable":true}}','{"status":{"value":"active","writable":true}}')returning id`,
      [owner, d],
    )
  ).rows[0].id;
  const area = (
    await db.query<{ id: string }>(
      "insert into life_areas(user_id,slug,name,color,icon,sort_order)values($1,'career','[TEST]','#123456','briefcase',1)returning id",
      [owner],
    )
  ).rows[0].id;
  const project = (
    await db.query<{ id: string }>(
      "insert into projects(user_id,area_id,name)values($1,$2,'[TEST] linked project')returning id",
      [owner, area],
    )
  ).rows[0].id;
  const mapping = {
    active: "active",
    paused: "paused",
    completed: "completed",
    cancelled: "cancelled",
  };
  await db.query(
    "select bind_sheet_rest_project($1,$2,$3,1,$4,1,'status',$5)",
    [owner, d, r, project, JSON.stringify(mapping)],
  );
  await db.exec(
    `set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false)`,
  );
  await db.query("update projects set status='completed'where id=$1", [
    project,
  ]);
  await db.exec("reset role");
  expect(
    (
      await db.query("select local_values from sheet_rest_rows where id=$1", [
        r,
      ])
    ).rows[0],
  ).toEqual({ local_values: { status: "completed" } });
  expect(
    (
      await db.query(
        "select status,intended from sheet_rest_operations where row_id=$1",
        [r],
      )
    ).rows[0],
  ).toEqual({ status: "draft", intended: { status: "completed" } });
  // Incoming source merges update the same project once and do not enqueue an echo.
  await db.query(
    `update sheet_rest_rows set local_values='{"status":"paused"}'where id=$1`,
    [r],
  );
  await db.query(
    "update sheet_rest_datasets set last_read_at=now()where id=$1",
    [d],
  );
  expect(
    (await db.query("select status from projects where id=$1", [project]))
      .rows[0],
  ).toEqual({ status: "paused" });
  expect(
    (
      await db.query(
        "select count(*)::int n from sheet_rest_operations where row_id=$1",
        [r],
      )
    ).rows[0],
  ).toEqual({ n: 1 });
});
