import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
const owner = "11111111-1111-4111-8111-111111111111",
  full = "44444444-4444-4444-8444-444444444441",
  blank = "44444444-4444-4444-8444-444444444442";
let db: PGlite, dataset: string, version: number;
const cell = (value: unknown) => ({
  value,
  display: String(value),
  formula: null,
  source_writable: true,
  writable: true,
  allowed: null,
  error: null,
});
beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync("tests/auth-fixture.sql", "utf8"));
  await db.query("insert into auth.users values($1)", [owner]);
  for (const f of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
  await db.query("insert into private.approved_users values($1)", [owner]);
  const connection = (
    await db.query<{ id: string }>(
      "insert into calendar_connections(user_id,provider,provider_account_id)values($1,'google','x')returning id",
      [owner],
    )
  ).rows[0].id;
  const source = (
    await db.query<{ id: string }>(
      "insert into data_sources(user_id,provider,source_key)values($1,'google_sheets','syntheticSheet002')returning id",
      [owner],
    )
  ).rows[0].id;
  const config = {
    header_row: 0,
    start_column: 0,
    allow_insert: false,
    allow_delete: false,
    columns: [
      { key: "id", header: "ID", key_part: true, writable: false },
      { key: "win", header: "Win", writable: true },
    ],
  };
  dataset = (
    await db.query<{ id: string }>(
      "insert into sheet_rest_datasets(user_id,connection_id,source_id,spreadsheet_id,worksheet_id,title,worksheet_title,config,outbound_enabled,production_approved_at,mode)values($1,$2,$3,'syntheticSheet002',0,'t','t',$4::jsonb,true,now(),'two_way')returning id",
      [owner, connection, source, JSON.stringify(config)],
    )
  ).rows[0].id;
  for (const [id, key, win] of [
    [full, "k1", "typed before ownership"],
    [blank, "k2", null],
  ] as const)
    await db.query(
      "insert into sheet_rest_rows(id,user_id,dataset_id,external_key,key_values,baseline,remote_cells,local_values)values($1,$2,$3,$4,'[1]'::jsonb,$5::jsonb,$5::jsonb,$6::jsonb)",
      [
        id,
        owner,
        dataset,
        key,
        JSON.stringify({ win: cell(win) }),
        JSON.stringify({ win }),
      ],
    );
  version = (
    await db.query<{ version: number }>(
      "select version from sheet_rest_datasets where id=$1",
      [dataset],
    )
  ).rows[0].version;
});
afterAll(async () => {
  await db.close();
});
it("rejects owned mode without a date and activates atomically, freezing only rows with content", async () => {
  await expect(
    db.query(
      "update sheet_rest_datasets set mode='life_os_owned' where id=$1",
      [dataset],
    ),
  ).rejects.toThrow();
  const r = await db.query<{ n: number }>(
    "select activate_life_os_owned($1,$2,$3,true,false)n",
    [owner, dataset, version],
  );
  expect(r.rows[0].n).toBe(1);
  const rows = await db.query<{ id: string; frozen: boolean }>(
    "select id,frozen from sheet_rest_rows order by external_key",
  );
  expect(rows.rows.map((x) => x.frozen)).toEqual([true, false]);
  const d = (
    await db.query<{ mode: string; owner_since: string; ai: boolean }>(
      "select mode,owner_since,(config->>'allow_insert')::boolean ai from sheet_rest_datasets where id=$1",
      [dataset],
    )
  ).rows[0];
  expect(d.mode).toBe("life_os_owned");
  expect(d.owner_since).toBeTruthy();
  expect(d.ai).toBe(true);
});
it("refuses any write operation on a frozen row but accepts one on an empty row", async () => {
  const edit = async (row: string, request: string) => {
    const v = (
      await db.query<{ version: number }>(
        "select version from sheet_rest_rows where id=$1",
        [row],
      )
    ).rows[0].version;
    return db.query(
      "select edit_sheet_rest($1,$2,$3,$4,$5,'update','{\"win\":\"from Life OS\"}'::jsonb,null,null)",
      [owner, dataset, row, v, request],
    );
  };
  await expect(
    edit(full, "55555555-5555-4555-8555-555555555551"),
  ).rejects.toThrow(/read-only history/);
  await edit(blank, "55555555-5555-4555-8555-555555555552");
  const ops = await db.query<{ status: string }>(
    "select status from sheet_rest_operations",
  );
  expect(ops.rows).toEqual([{ status: "draft" }]);
});
it("will not activate a table whose outbound writes were never authorized", async () => {
  await db.query(
    "update sheet_rest_datasets set mode='two_way',owner_since=null,outbound_enabled=false where id=$1",
    [dataset],
  );
  const v = (
    await db.query<{ version: number }>(
      "select version from sheet_rest_datasets where id=$1",
      [dataset],
    )
  ).rows[0].version;
  await expect(
    db.query("select activate_life_os_owned($1,$2,$3,false,false)", [
      owner,
      dataset,
      v,
    ]),
  ).rejects.toThrow(/not activated/);
});
