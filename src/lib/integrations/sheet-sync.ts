import { z } from "zod";
export const statusValues = z
  .object({
    active: z.string().trim().min(1).max(100),
    paused: z.string().trim().min(1).max(100),
    completed: z.string().trim().min(1).max(100),
    cancelled: z.string().trim().min(1).max(100),
  })
  .strict()
  .refine(
    (x) => new Set(Object.values(x)).size === 4,
    "Each project status needs a distinct spreadsheet value.",
  );
const cell = z.object({
  userEnteredValue: z
    .object({
      stringValue: z.string().optional(),
      numberValue: z.number().optional(),
      boolValue: z.boolean().optional(),
      formulaValue: z.string().optional(),
    })
    .optional(),
  effectiveValue: z
    .object({
      stringValue: z.string().optional(),
      numberValue: z.number().optional(),
      boolValue: z.boolean().optional(),
    })
    .optional(),
});
export const gridSchema = z.object({
  spreadsheetId: z.string(),
  properties: z.object({ title: z.string() }),
  sheets: z.array(
    z.object({
      properties: z.object({ sheetId: z.number().int(), title: z.string() }),
      protectedRanges: z.array(z.unknown()).optional(),
      data: z
        .array(
          z.object({
            startRow: z.number().int().optional(),
            startColumn: z.number().int().optional(),
            rowData: z
              .array(z.object({ values: z.array(cell).optional() }))
              .optional(),
          }),
        )
        .optional(),
    }),
  ),
});
export type SheetGrid = z.infer<typeof gridSchema>;
/** Numeric row locations are diagnostic only. Every read resolves the stable ID again. */
export function locateSheetRecord(
  grid: SheetGrid,
  sheetId: number,
  idColumn: string,
  statusColumn: string,
  externalId: string,
  values: Record<string, string>,
) {
  const sheet = grid.sheets.find((s) => s.properties.sheetId === sheetId);
  if (!sheet) throw Error("The mapped worksheet is missing.");
  const segment = sheet.data?.[0];
  if ((segment?.startRow ?? 0) !== 0 || (segment?.startColumn ?? 0) !== 0)
    throw Error("Unexpected spreadsheet range.");
  const rows = segment?.rowData ?? [];
  const plain = (c: z.infer<typeof cell> | undefined) =>
    String(
      c?.effectiveValue?.stringValue ??
        c?.effectiveValue?.numberValue ??
        c?.effectiveValue?.boolValue ??
        c?.userEnteredValue?.stringValue ??
        c?.userEnteredValue?.numberValue ??
        c?.userEnteredValue?.boolValue ??
        "",
    ).trim();
  const headers = (rows[0]?.values ?? []).map(plain);
  if (
    new Set(headers).size !== headers.length ||
    !headers.includes(idColumn) ||
    !headers.includes(statusColumn) ||
    idColumn === statusColumn
  )
    throw Error("Spreadsheet headers changed or are ambiguous.");
  const idIndex = headers.indexOf(idColumn),
    statusIndex = headers.indexOf(statusColumn);
  const seen = new Set<string>();
  let found: {
    row: number;
    value: string;
    formula: boolean;
    status: string | null;
  } | null = null;
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].values ?? [],
      id = plain(cells[idIndex]);
    if (!id) continue;
    if (cells[idIndex]?.userEnteredValue?.formulaValue)
      throw Error("Stable source IDs must not be formulas.");
    if (seen.has(id))
      throw Error("Duplicate stable spreadsheet ID. No changes were applied.");
    seen.add(id);
    if (id === externalId) {
      const value = plain(cells[statusIndex]);
      found = {
        row: i + 1,
        value,
        formula:
          !!cells[statusIndex]?.userEnteredValue?.formulaValue ||
          (!cells[statusIndex]?.userEnteredValue &&
            !!cells[statusIndex]?.effectiveValue) ||
          !!sheet.protectedRanges?.length,
        status: Object.keys(values).find((k) => values[k] === value) ?? null,
      };
    }
  }
  return found;
}
export function fieldMerge(base: string, local: string, remote: string) {
  if (local === remote) return "converged";
  if (local === base) return "incoming";
  if (remote === base) return "outgoing";
  return "conflict";
}
