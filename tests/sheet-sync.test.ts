import { it, expect } from "vitest";
import {
  gridSchema,
  locateSheetRecord,
  fieldMerge,
  statusValues,
} from "../src/lib/integrations/sheet-sync";
const values = {
  active: "In Progress",
  paused: "Paused",
  completed: "Complete",
  cancelled: "Cancelled",
};
const c = (s: string) => ({
  userEnteredValue: { stringValue: s },
  effectiveValue: { stringValue: s },
});
const grid = (rows: unknown[][]) =>
  gridSchema.parse({
    spreadsheetId: "syntheticSheet001",
    properties: { title: "[TEST]" },
    sheets: [
      {
        properties: { sheetId: 7, title: "[TEST]" },
        data: [{ rowData: rows.map((values) => ({ values })) }],
      },
    ],
  });
it("resolves moved rows by a stable ID and rejects duplicates or changed headers", () => {
  const a = grid([
    [c("ID"), c("Status")],
    [c("b"), c("Paused")],
    [c("a"), c("Complete")],
  ]);
  expect(locateSheetRecord(a, 7, "ID", "Status", "a", values)).toMatchObject({
    row: 3,
    status: "completed",
  });
  expect(
    locateSheetRecord(
      grid([
        [c("ID"), c("Status")],
        [c("a"), c("Complete")],
        [c("b"), c("Paused")],
      ]),
      7,
      "ID",
      "Status",
      "a",
      values,
    ),
  ).toMatchObject({ row: 2, status: "completed" });
  expect(() =>
    locateSheetRecord(
      grid([
        [c("ID"), c("Status")],
        [c("a"), c("Complete")],
        [c("a"), c("Paused")],
      ]),
      7,
      "ID",
      "Status",
      "a",
      values,
    ),
  ).toThrow(/Duplicate/);
  expect(() =>
    locateSheetRecord(a, 7, "Renamed", "Status", "a", values),
  ).toThrow(/headers/);
  expect(locateSheetRecord(a, 7, "ID", "Status", "removed", values)).toBeNull();
});
it("detects formulas, array outputs, protected sheets and formula-based IDs without overwriting them", () => {
  const formula = {
    userEnteredValue: { formulaValue: '=IF(1,"Complete","Paused")' },
    effectiveValue: { stringValue: "Complete" },
  };
  expect(
    locateSheetRecord(
      grid([
        [c("ID"), c("Status")],
        [c("a"), formula],
      ]),
      7,
      "ID",
      "Status",
      "a",
      values,
    )?.formula,
  ).toBe(true);
  expect(
    locateSheetRecord(
      grid([
        [c("ID"), c("Status")],
        [c("a"), { effectiveValue: { stringValue: "Complete" } }],
      ]),
      7,
      "ID",
      "Status",
      "a",
      values,
    )?.formula,
  ).toBe(true);
  const protectedGrid = grid([
    [c("ID"), c("Status")],
    [c("a"), c("Complete")],
  ]);
  protectedGrid.sheets[0].protectedRanges = [{}];
  expect(
    locateSheetRecord(protectedGrid, 7, "ID", "Status", "a", values)?.formula,
  ).toBe(true);
  expect(() =>
    locateSheetRecord(
      grid([
        [c("ID"), c("Status")],
        [
          {
            userEnteredValue: { formulaValue: '="a"' },
            effectiveValue: { stringValue: "a" },
          },
          c("Complete"),
        ],
      ]),
      7,
      "ID",
      "Status",
      "a",
      values,
    ),
  ).toThrow(/IDs/);
});
it("distinguishes safe field merges from concurrent changes and validates status mappings", () => {
  expect(fieldMerge("active", "active", "completed")).toBe("incoming");
  expect(fieldMerge("active", "paused", "active")).toBe("outgoing");
  expect(fieldMerge("active", "completed", "completed")).toBe("converged");
  expect(fieldMerge("active", "paused", "completed")).toBe("conflict");
  expect(
    statusValues.safeParse({ ...values, paused: "In Progress" }).success,
  ).toBe(false);
});
