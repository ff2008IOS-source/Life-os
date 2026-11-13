import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ admin: null as unknown }));
vi.mock("../src/lib/integrations/google-server", () => ({
  integrationAdmin: () => state.admin,
}));
vi.mock("../src/lib/integrations/sheets-rest-access", () => ({
  withRestSheetsAccess: async (
    _u: string,
    _c: string,
    _w: boolean,
    operation: (t: string) => Promise<unknown>,
  ) => operation("synthetic-token"),
}));
import {
  synchronizeDataset,
  ledgerRows,
  ownedDataset,
} from "../src/lib/integrations/sheet-rest-server";
import { datasetConfig } from "../src/lib/integrations/sheet-ledger-model";
const owner = "11111111-1111-4111-8111-111111111111",
  spreadsheet = "syntheticIntegrationSheet";
let pg: PGlite,
  dataset: string,
  loseResponse = false;
type Cell = {
  userEnteredValue?: {
    stringValue?: string;
    numberValue?: number;
    formulaValue?: string;
  };
  effectiveValue?: { stringValue?: string; numberValue?: number };
};
const value = (v: string | number): Cell =>
  typeof v === "string"
    ? {
        userEnteredValue: { stringValue: v },
        effectiveValue: { stringValue: v },
      }
    : {
        userEnteredValue: { numberValue: v },
        effectiveValue: { numberValue: v },
      };
const grid: Cell[][] = [
  [value("ID"), value("Value"), value("Formula")],
  [
    value("stable-1"),
    value(4),
    {
      userEnteredValue: { formulaValue: "=B2*2" },
      effectiveValue: { numberValue: 8 },
    },
  ],
];
// Test-only PostgREST-shaped adapter: real constraints, transactions, functions and audit triggers execute in PostgreSQL.
class Query implements PromiseLike<unknown> {
  filters: string[] = [];
  params: unknown[] = [];
  verb = "select";
  body: Record<string, unknown> | null = null;
  one = false;
  sort = "";
  size = 1000;
  offset = 0;
  constructor(public table: string) {}
  param(v: unknown) {
    this.params.push(
      v !== null && typeof v === "object" ? JSON.stringify(v) : v,
    );
    return "$" + this.params.length;
  }
  select() {
    return this;
  }
  insert(v: Record<string, unknown>) {
    this.verb = "insert";
    this.body = v;
    return this;
  }
  update(v: Record<string, unknown>) {
    this.verb = "update";
    this.body = v;
    return this;
  }
  eq(k: string, v: unknown) {
    this.filters.push(`"${k}"=${this.param(v)}`);
    return this;
  }
  neq(k: string, v: unknown) {
    this.filters.push(`"${k}"<>${this.param(v)}`);
    return this;
  }
  lte(k: string, v: unknown) {
    this.filters.push(`"${k}"<=${this.param(v)}`);
    return this;
  }
  in(k: string, values: unknown[]) {
    this.filters.push(
      `"${k}" in(${values.map((v) => this.param(v)).join(",")})`,
    );
    return this;
  }
  order(k: string) {
    this.sort = ` order by "${k}"`;
    return this;
  }
  limit(n: number) {
    this.size = n;
    return this;
  }
  range(a: number, b: number) {
    this.offset = a;
    this.size = b - a + 1;
    return this;
  }
  single() {
    this.one = true;
    return this;
  }
  then<TResult1 = unknown, TResult2 = never>(
    a?: ((v: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    b?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.run().then(a, b);
  }
  async run() {
    try {
      const where = this.filters.length
        ? " where " + this.filters.join(" and ")
        : "";
      let sql = "";
      if (this.verb === "select")
        sql = `select * from "${this.table}"${where}${this.sort} limit ${this.size} offset ${this.offset}`;
      else {
        const keys = Object.keys(this.body!);
        sql =
          this.verb === "insert"
            ? `insert into "${this.table}"(${keys.map((k) => '"' + k + '"').join(",")})values(${keys.map((k) => this.param(this.body![k])).join(",")})returning *`
            : `update "${this.table}" set ${keys.map((k) => '"' + k + '"=' + this.param(this.body![k])).join(",")}${where} returning *`;
      }
      const r = await pg.query(sql, this.params);
      return { data: this.one ? (r.rows[0] ?? null) : r.rows, error: null };
    } catch (e) {
      return { data: null, error: e };
    }
  }
}
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(readFileSync("tests/auth-fixture.sql", "utf8"));
  await pg.query("insert into auth.users values($1)", [owner]);
  for (const f of readdirSync("supabase/migrations").sort())
    await pg.exec(readFileSync("supabase/migrations/" + f, "utf8"));
  await pg.query("insert into private.approved_users values($1)", [owner]);
  const c = (
    await pg.query<{ id: string }>(
      "insert into calendar_connections(user_id,provider,provider_account_id)values($1,'google','[TEST]')returning id",
      [owner],
    )
  ).rows[0].id;
  const s = (
    await pg.query<{ id: string }>(
      "insert into data_sources(user_id,provider,source_key)values($1,'google_sheets',$2)returning id",
      [owner, spreadsheet],
    )
  ).rows[0].id;
  const config = datasetConfig.parse({
    sheet_id: 0,
    header_row: 0,
    end_row: 20,
    start_column: 0,
    end_column: 3,
    columns: [
      { key: "id", header: "ID", type: "text", key_part: true },
      { key: "value", header: "Value", type: "integer", writable: true },
      { key: "formula", header: "Formula", type: "integer" },
    ],
  });
  dataset = (
    await pg.query<{ id: string }>(
      `insert into sheet_rest_datasets(user_id,connection_id,source_id,spreadsheet_id,worksheet_id,title,worksheet_title,config,mode,test_only,outbound_enabled)values($1,$2,$3,$4,0,'[TEST]','Test',$5,'two_way',true,true)returning id`,
      [owner, c, s, spreadsheet, JSON.stringify(config)],
    )
  ).rows[0].id;
  state.admin = {
    from: (t: string) => new Query(t),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      try {
        const entries = Object.entries(args);
        const r = await pg.query<{ result: unknown }>(
          `select public.${fn}(${entries.map(([k], i) => k + "=> $" + (i + 1)).join(",")}) as result`,
          entries.map(([, v]) =>
            v !== null && typeof v === "object" ? JSON.stringify(v) : v,
          ),
        );
        return { data: r.rows[0].result, error: null };
      } catch (e) {
        return { data: null, error: e };
      }
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL, init: RequestInit) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe("sheets.googleapis.com");
      if (init.method === "POST") {
        const body = JSON.parse(String(init.body));
        for (const item of body.data) {
          const m = /!([A-Z]+)(\d+):/.exec(item.range)!;
          grid[Number(m[2]) - 1][m[1].charCodeAt(0) - 65] = value(
            item.values[0][0],
          );
        }
        if (loseResponse) {
          loseResponse = false;
          throw Error("Synthetic response loss after provider write");
        }
        return Response.json({
          spreadsheetId: spreadsheet,
          totalUpdatedCells: body.data.length,
        });
      }
      return Response.json(
        url.searchParams.has("includeGridData")
          ? {
              spreadsheetId: spreadsheet,
              properties: { title: "[TEST]" },
              sheets: [
                {
                  properties: { sheetId: 0, title: "Test" },
                  data: [{ rowData: grid.map((values) => ({ values })) }],
                },
              ],
            }
          : {
              spreadsheetId: spreadsheet,
              properties: { title: "[TEST]" },
              sheets: [
                {
                  properties: {
                    sheetId: 0,
                    title: "Test",
                    gridProperties: { rowCount: 20, columnCount: 3 },
                  },
                },
              ],
            },
      );
    }),
  );
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await pg.close();
});
async function draft(n: number) {
  const row = (await ledgerRows(await ownedDataset(owner, dataset)))[0];
  const op = randomUUID();
  await pg.query(
    "select edit_sheet_rest($1,$2,$3,$4,$5,'update',$6,null,null)",
    [owner, dataset, row.id, row.version, op, JSON.stringify({ value: n })],
  );
  await pg.query("select approve_sheet_rest($1,$2,$3,1)", [owner, dataset, op]);
  return op;
}
it("runs the actual sync service against PostgreSQL and a synthetic REST provider in both directions", async () => {
  await synchronizeDataset(owner, dataset);
  expect((await ledgerRows(await ownedDataset(owner, dataset))).length).toBe(1);
  await draft(5);
  await synchronizeDataset(owner, dataset);
  expect(grid[1][1].effectiveValue?.numberValue).toBe(5);
  expect(grid[1][2].userEnteredValue?.formulaValue).toBe("=B2*2");
  grid[1][1] = value(6);
  await synchronizeDataset(owner, dataset);
  expect(
    (await ledgerRows(await ownedDataset(owner, dataset)))[0].local_values
      .value,
  ).toBe(6);
  await synchronizeDataset(owner, dataset);
  expect((await ledgerRows(await ownedDataset(owner, dataset))).length).toBe(1);
});
it("reconciles a lost successful provider response without repeating a write", async () => {
  const op = await draft(7);
  loseResponse = true;
  await expect(synchronizeDataset(owner, dataset)).rejects.toMatchObject({
    code: "UNKNOWN_OUTCOME",
  });
  expect(
    (
      await pg.query("select status from sheet_rest_operations where id=$1", [
        op,
      ])
    ).rows[0],
  ).toEqual({ status: "unknown" });
  await pg.query(
    "update sheet_rest_datasets set next_sync_at=now(),last_error_code=null where id=$1",
    [dataset],
  );
  await pg.query(
    "update sheet_rest_operations set next_attempt_at=now()where id=$1",
    [op],
  );
  const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
    (c) => (c[1] as RequestInit).method === "POST",
  ).length;
  await synchronizeDataset(owner, dataset);
  expect(
    (
      await pg.query("select status from sheet_rest_operations where id=$1", [
        op,
      ])
    ).rows[0],
  ).toEqual({ status: "confirmed" });
  expect(
    (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => (c[1] as RequestInit).method === "POST",
    ).length,
  ).toBe(calls);
});
it("holds simultaneous edits for review rather than overwriting Google", async () => {
  await draft(8);
  grid[1][1] = value(9);
  const result = await synchronizeDataset(owner, dataset);
  expect(result.conflicts).toBe(1);
  expect(grid[1][1].effectiveValue?.numberValue).toBe(9);
  const row = (await ledgerRows(await ownedDataset(owner, dataset)))[0];
  expect(row.conflicts).toMatchObject({
    value: { base: 7, local: 8, remote: 9 },
  });
});
