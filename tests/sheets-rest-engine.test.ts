import { it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  datasetConfig,
  mergeSheetFields,
} from "../src/lib/integrations/sheet-ledger-model";
import { parseRestSnapshot } from "../src/lib/integrations/sheet-rest-snapshot";
import { planRestWrite } from "../src/lib/integrations/sheet-rest-plan";
import { withRestSheetsAccess } from "../src/lib/integrations/sheets-rest-access";
import { SheetsRestError } from "../src/lib/integrations/sheets-rest-provider";
vi.mock("../src/lib/integrations/google-server", () => ({
  connectionAccessForUser: vi.fn(),
}));
const id = "syntheticSpreadsheet001";
const config = datasetConfig.parse({
  sheet_id: 0,
  header_row: 0,
  end_row: 20,
  start_column: 0,
  end_column: 4,
  columns: [
    { key: "id", header: "ID", type: "text", key_part: true },
    { key: "value", header: "Value", type: "integer", writable: true },
    { key: "formula", header: "Calculated", type: "integer" },
  ],
  allow_insert: true,
  allow_delete: true,
});
const v = (value: string | number) =>
  typeof value === "string"
    ? {
        userEnteredValue: { stringValue: value },
        effectiveValue: { stringValue: value },
      }
    : {
        userEnteredValue: { numberValue: value },
        effectiveValue: { numberValue: value },
      };
function grid(value = 4, reverse = false) {
  const data = [
    { values: [v("ID"), v("Value"), v("Calculated"), v("Unmapped")] },
    {
      values: [
        v("a"),
        v(value),
        {
          userEnteredValue: { formulaValue: "=B2*2" },
          effectiveValue: { numberValue: value * 2 },
        },
        v("preserve"),
      ],
    },
    { values: [v("b"), v(2)] },
  ];
  if (reverse) [data[1], data[2]] = [data[2], data[1]];
  return {
    spreadsheetId: id,
    properties: { title: "[TEST]" },
    sheets: [
      { properties: { sheetId: 0, title: "Test" }, data: [{ rowData: data }] },
    ],
  };
}
const snap = (value = 4, reverse = false) =>
  parseRestSnapshot(grid(value, reverse), id, config);
it("performs field-level merges without loops or silent conflicting edits", () => {
  const b = snap().rows[0].cells;
  expect(
    mergeSheetFields(
      b,
      { id: "a", value: 4, formula: 8 },
      snap(5).rows[0].cells,
    ).values.value,
  ).toBe(5);
  const m = mergeSheetFields(
    b,
    { id: "a", value: 6, formula: 8 },
    snap(5).rows[0].cells,
  );
  expect(m.conflicts.value).toMatchObject({ base: 4, local: 6, remote: 5 });
  expect(
    mergeSheetFields(
      b,
      { id: "a", value: 5, formula: 8 },
      snap(5).rows[0].cells,
    ).conflicts,
  ).toEqual({});
});
it("re-resolves stable identity after row reorder and only targets changed fields", () => {
  const before = snap(),
    after = snap(4, true);
  const p = planRestWrite(after, {
    operation_type: "update",
    external_key: before.rows[0].external_key,
    intended: { value: 5 },
    expected_cells: before.rows[0].cells,
  });
  expect(p.changes).toEqual([{ range: "'Test'!B3:B3", value: 5 }]);
});
it("rejects stale approval, formula writes, source deletions and duplicate identities", () => {
  const before = snap();
  expect(() =>
    planRestWrite(snap(7), {
      operation_type: "update",
      external_key: before.rows[0].external_key,
      intended: { value: 5 },
      expected_cells: before.rows[0].cells,
    }),
  ).toThrow("changed");
  expect(() =>
    planRestWrite(before, {
      operation_type: "update",
      external_key: before.rows[0].external_key,
      intended: { formula: 12 },
      expected_cells: before.rows[0].cells,
    }),
  ).toThrow("source-owned");
  expect(() =>
    planRestWrite(before, {
      operation_type: "delete",
      external_key: before.rows[0].external_key,
      intended: { id: null, value: null, formula: null },
      expected_cells: before.rows[0].cells,
    }),
  ).toThrow("formula");
  const g = grid();
  g.sheets[0].data[0].rowData.push(g.sheets[0].data[0].rowData[1]);
  expect(() => parseRestSnapshot(g, id, config)).toThrow("Duplicate");
});
it("reconciles unknown outcomes by content and never blindly repeats a write", () => {
  const before = snap(),
    intent = {
      operation_type: "update" as const,
      external_key: before.rows[0].external_key,
      intended: { value: 5 },
      expected_cells: before.rows[0].cells,
      uncertain: true,
    };
  expect(planRestWrite(snap(5), intent).converged).toBe(true);
  expect(() => planRestWrite(snap(), intent)).toThrow("uncertain");
});
it("preserves formulas, array outputs and protected cells as read-only", () => {
  const g = grid() as ReturnType<typeof grid> & {
    sheets: { protectedRanges?: unknown[] }[];
  };
  g.sheets[0].protectedRanges = [
    {
      range: {
        sheetId: 0,
        startRowIndex: 1,
        endRowIndex: 2,
        startColumnIndex: 1,
        endColumnIndex: 2,
      },
    },
  ];
  const s = parseRestSnapshot(g, id, config);
  expect(s.rows[0].cells.value.writable).toBe(false);
  const output = grid();
  output.sheets[0].data[0].rowData[1].values[1] = {
    effectiveValue: { numberValue: 7 },
  } as ReturnType<typeof v>;
  expect(
    parseRestSnapshot(output, id, config).rows[0].cells.value.writable,
  ).toBe(false);
});
it("refreshes expired credentials once and keeps read-only grants from writing", async () => {
  const access = vi.fn(async (_u: string, _c: string, force?: boolean) => ({
    token: force ? "new" : "old",
    scope: "https://www.googleapis.com/auth/spreadsheets",
  }));
  const operation = vi.fn(async (token: string) => {
    if (token === "old")
      throw new SheetsRestError("AUTH_REQUIRED", "Reconnect");
    return true;
  });
  expect(
    await withRestSheetsAccess("owner", "connection", true, operation, access),
  ).toBe(true);
  expect(access).toHaveBeenLastCalledWith("owner", "connection", true);
  await expect(
    withRestSheetsAccess("owner", "connection", true, operation, async () => ({
      token: "read",
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    })),
  ).rejects.toMatchObject({ code: "PERMISSION" });
});
it("rechecks live dropdown rules even for outbox edits created by a project trigger", () => {
  const g = grid() as unknown as {
    sheets: { data: { rowData: { values: unknown[] }[] }[] }[];
  };
  (
    g.sheets[0].data[0].rowData[1].values[1] as Record<string, unknown>
  ).dataValidation = {
    condition: {
      type: "ONE_OF_LIST",
      values: [{ userEnteredValue: "4" }, { userEnteredValue: "5" }],
    },
  };
  const s = parseRestSnapshot(g, id, config);
  expect(() =>
    planRestWrite(s, {
      operation_type: "update",
      external_key: s.rows[0].external_key,
      intended: { value: 6 },
      expected_cells: s.rows[0].cells,
    }),
  ).toThrow("permitted");
});

it("life_os_owned overwrites only fields Life OS wrote and freezes history", () => {
  const cell = (value: string | number | null) => ({
    value,
    display: String(value),
    formula: null,
    source_writable: true,
    writable: true,
    allowed: null,
    error: null,
  });
  const base = { win: cell(1), notes: cell(null) },
    local = { win: 5, notes: null },
    remote = { win: cell(9), notes: cell("typed by hand") };
  const fresh = mergeSheetFields(
    base,
    local,
    remote,
    "life_os_owned",
    false,
    new Set(["win"]),
  );
  expect(fresh.values.win).toBe(5);
  expect(fresh.baseline.win.value).toBe(9);
  expect(fresh.values.notes).toBe("typed by hand");
  expect(fresh.conflicts).toEqual({});
  const old = mergeSheetFields(
    base,
    local,
    remote,
    "life_os_owned",
    true,
    new Set(["win"]),
  );
  expect(old.values.win).toBe(9);
  expect(old.conflicts).toEqual({});
});
