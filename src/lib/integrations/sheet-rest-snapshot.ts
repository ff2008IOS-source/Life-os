import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  datasetConfig,
  identityValues,
  validateField,
  type DatasetConfig,
  type Cell,
  type Cells,
  type Values,
} from "./sheet-ledger-model";
export const contentHash = (x: unknown) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
const entered = z.object({
  stringValue: z.string().optional(),
  numberValue: z.number().finite().optional(),
  boolValue: z.boolean().optional(),
  formulaValue: z.string().optional(),
});
const rawCell = z.object({
  userEnteredValue: entered.optional(),
  effectiveValue: entered
    .extend({
      errorValue: z
        .object({ type: z.string(), message: z.string().optional() })
        .optional(),
    })
    .optional(),
  formattedValue: z.string().optional(),
  userEnteredFormat: z.record(z.string(), z.unknown()).optional(),
  dataValidation: z
    .object({
      condition: z.object({
        type: z.string(),
        values: z
          .array(z.object({ userEnteredValue: z.string().optional() }))
          .optional(),
      }),
    })
    .optional(),
});
const gridRange = z.object({
  sheetId: z.number().optional(),
  startRowIndex: z.number().optional(),
  endRowIndex: z.number().optional(),
  startColumnIndex: z.number().optional(),
  endColumnIndex: z.number().optional(),
});
export const restGridSchema = z.object({
  spreadsheetId: z.string(),
  properties: z.object({ title: z.string() }),
  sheets: z.array(
    z.object({
      properties: z.object({ sheetId: z.number().int(), title: z.string() }),
      protectedRanges: z
        .array(
          z.object({
            range: gridRange.optional(),
            unprotectedRanges: z.array(gridRange).optional(),
            warningOnly: z.boolean().optional(),
          }),
        )
        .optional(),
      data: z
        .array(
          z.object({
            startRow: z.number().int().optional(),
            startColumn: z.number().int().optional(),
            rowData: z
              .array(z.object({ values: z.array(rawCell).max(200).optional() }))
              .max(5001)
              .optional(),
          }),
        )
        .optional(),
    }),
  ),
});
export type RawCell = z.infer<typeof rawCell>;
export type SnapshotRow = {
  external_key: string;
  key_values: ReturnType<typeof identityValues>;
  row_locator: number;
  cells: Cells;
  values: Values;
  remote_hash: string;
};
export type TableSnapshot = {
  spreadsheet: string;
  worksheet: number;
  title: string;
  config: DatasetConfig;
  positions: Record<string, number>;
  rows: SnapshotRow[];
  hash: string;
  raw: RawCell[][];
  cell: (row: number, column: number) => Cell;
};
export function parseRestSnapshot(
  input: unknown,
  spreadsheet: string,
  configuration: DatasetConfig,
): TableSnapshot {
  const config = datasetConfig.parse(configuration),
    grid = restGridSchema.parse(input);
  if (grid.spreadsheetId !== spreadsheet)
    throw Error("Spreadsheet identity changed.");
  const sheet = grid.sheets.find(
    (s) => s.properties.sheetId === config.sheet_id,
  );
  if (!sheet) throw Error("The mapped worksheet is missing.");
  if (sheet.data?.length !== 1)
    throw Error("Expected one bounded worksheet range.");
  const data = sheet.data[0];
  if (
    (data.startRow ?? 0) !== config.header_row ||
    (data.startColumn ?? 0) !== config.start_column
  )
    throw Error("The source range changed.");
  const raw = (data.rowData ?? []).map((r) => r.values ?? []);
  const value = (c: RawCell | undefined) =>
    c?.effectiveValue?.stringValue ??
    c?.effectiveValue?.numberValue ??
    c?.effectiveValue?.boolValue ??
    c?.userEnteredValue?.stringValue ??
    c?.userEnteredValue?.numberValue ??
    c?.userEnteredValue?.boolValue ??
    null;
  const headers = (raw[0] ?? []).map((c) => String(value(c) ?? "").trim()),
    positions: Record<string, number> = {};
  for (const col of config.columns) {
    const matches = headers.flatMap((h, i) => (h === col.header ? [i] : []));
    if (matches.length !== 1)
      throw Error(`Source header missing or ambiguous: ${col.header}.`);
    positions[col.key] = matches[0] + config.start_column;
  }
  const within = (
    r: z.infer<typeof gridRange> | undefined,
    row: number,
    column: number,
  ) =>
    !!r &&
    (r.sheetId === undefined || r.sheetId === config.sheet_id) &&
    row >= (r.startRowIndex ?? 0) &&
    row < (r.endRowIndex ?? Infinity) &&
    column >= (r.startColumnIndex ?? 0) &&
    column < (r.endColumnIndex ?? Infinity);
  const cell = (row: number, column: number): Cell => {
    const c = raw[row - config.header_row]?.[column - config.start_column];
    const v = value(c);
    const formula = c?.userEnteredValue?.formulaValue ?? null;
    const arrayOutput = !c?.userEnteredValue && !!c?.effectiveValue;
    const protectedCell =
      sheet.protectedRanges?.some(
        (p) =>
          (!p.range || within(p.range, row, column)) &&
          !p.unprotectedRanges?.some((r) => within(r, row, column)),
      ) ?? false;
    const condition = c?.dataValidation?.condition;
    const allowed =
      condition?.type === "ONE_OF_LIST" &&
      condition.values?.every(
        (v) =>
          typeof v.userEnteredValue === "string" &&
          !v.userEnteredValue.startsWith("="),
      )
        ? condition.values.map((v) => v.userEnteredValue!)
        : null;
    const unsupportedValidation = !!condition && !allowed;
    const sourceWritable =
      !formula && !arrayOutput && !protectedCell && !unsupportedValidation;
    return {
      value: v,
      display: c?.formattedValue ?? String(v ?? ""),
      formula,
      source_writable: sourceWritable,
      writable: sourceWritable,
      allowed,
      error: c?.effectiveValue?.errorValue?.type ?? null,
    };
  };
  const rows: SnapshotRow[] = [],
    seen = new Set<string>();
  for (let index = 1; index < raw.length; index++) {
    const row = config.header_row + index,
      cells: Cells = {},
      values: Values = {};
    for (const col of config.columns) {
      const c = cell(row, positions[col.key]);
      cells[col.key] = {
        ...c,
        writable: c.source_writable && col.writable && !col.key_part,
      };
      values[col.key] = c.value;
    }
    const keys = config.columns.filter((c) => c.key_part);
    const missing = keys.filter(
      (c) => values[c.key] == null || String(values[c.key]).trim() === "",
    );
    if (missing.length === keys.length) {
      if (
        config.columns.some(
          (c) =>
            !cells[c.key].formula &&
            cells[c.key].value != null &&
            String(cells[c.key].value).trim() !== "",
        )
      )
        throw Error(
          "A populated source row has no stable identity. Review its mapped range.",
        );
      continue;
    }
    if (missing.length)
      throw Error("A source row has an incomplete stable identity.");
    if (keys.some((c) => cells[c.key].formula))
      throw Error("Stable source identity fields cannot be formulas.");
    for (const col of config.columns)
      if (cells[col.key].error && col.key_part)
        throw Error("Stable identity has a formula error.");
      else if (!cells[col.key].error) validateField(col, values[col.key]);
    const keyValues = identityValues(config, values),
      key = contentHash(keyValues);
    if (seen.has(key))
      throw Error("Duplicate stable source identity. No records were changed.");
    seen.add(key);
    rows.push({
      external_key: key,
      key_values: keyValues,
      row_locator: row,
      cells,
      values,
      remote_hash: contentHash(cells),
    });
  }
  return {
    spreadsheet,
    worksheet: config.sheet_id,
    title: sheet.properties.title,
    config,
    positions,
    rows,
    raw,
    cell,
    hash: contentHash({
      headers,
      raw,
      protection: sheet.protectedRanges ?? [],
    }),
  };
}
/** Locate an unused table row; never infer a writable blank from only its row number. */
export function blankRestRow(snapshot: TableSnapshot) {
  const { config } = snapshot;
  for (let row = config.header_row + 1; row < config.end_row; row++) {
    const cells = snapshot.raw[row - config.header_row] ?? [];
    if (
      cells.some(
        (c) =>
          !c.userEnteredValue?.formulaValue &&
          ((c.userEnteredValue?.stringValue != null &&
            c.userEnteredValue.stringValue !== "") ||
            c.userEnteredValue?.numberValue != null ||
            c.userEnteredValue?.boolValue != null),
      )
    )
      continue;
    if (
      config.columns.some(
        (col) =>
          col.key_part &&
          !snapshot.cell(row, snapshot.positions[col.key]).source_writable,
      )
    )
      continue;
    return row;
  }
  throw Error("No safe blank row exists inside the approved table range.");
}
