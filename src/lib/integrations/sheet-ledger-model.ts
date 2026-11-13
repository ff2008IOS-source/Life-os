import { z } from "zod";
export const scalar = z.union([
  z.string().max(10000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export type Scalar = z.infer<typeof scalar>;
export const sheetColumn = z
  .object({
    key: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,63}$/)
      .refine((x) => !["constructor", "prototype"].includes(x)),
    header: z.string().trim().min(1).max(150),
    type: z.enum(["text", "number", "integer", "boolean"]),
    key_part: z.boolean().default(false),
    writable: z.boolean().default(false),
  })
  .strict();
export const datasetConfig = z
  .object({
    sheet_id: z.number().int().nonnegative(),
    header_row: z.number().int().min(0).max(5000),
    end_row: z.number().int().positive().max(5001),
    start_column: z.number().int().min(0).max(199),
    end_column: z.number().int().min(1).max(200),
    columns: z.array(sheetColumn).min(1).max(50),
    allow_insert: z.boolean().default(false),
    allow_delete: z.boolean().default(false),
  })
  .strict()
  .superRefine((x, c) => {
    if (
      x.end_row <= x.header_row + 1 ||
      x.end_column <= x.start_column ||
      (x.end_row - x.header_row) * (x.end_column - x.start_column) > 30000
    )
      c.addIssue({
        code: "custom",
        message:
          "Select a bounded table of at most 30,000 cells, including headers.",
      });
    if (
      !x.columns.some((v) => v.key_part) ||
      x.columns.filter((v) => v.key_part).length > 4
    )
      c.addIssue({
        code: "custom",
        message: "Choose one to four stable identity fields.",
      });
    if (
      new Set(x.columns.map((v) => v.key)).size !== x.columns.length ||
      new Set(x.columns.map((v) => v.header)).size !== x.columns.length
    )
      c.addIssue({
        code: "custom",
        message: "Mapped fields and headers must be unique.",
      });
  });
export type DatasetConfig = z.infer<typeof datasetConfig>;
export type Cell = {
  value: Scalar;
  display: string;
  formula: string | null;
  source_writable: boolean;
  writable: boolean;
  allowed: string[] | null;
  error: string | null;
};
export type Cells = Record<string, Cell>;
export type Values = Record<string, Scalar>;
export type Conflict = {
  base: Scalar;
  local: Scalar;
  remote: Scalar;
  reason: string;
};
export type Conflicts = Record<string, Conflict>;
export const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function validateField(
  column: DatasetConfig["columns"][number],
  value: Scalar,
  cell?: Cell,
) {
  if (
    value !== null &&
    ((column.type === "text" && typeof value !== "string") ||
      (column.type === "boolean" && typeof value !== "boolean") ||
      (["number", "integer"].includes(column.type) &&
        typeof value !== "number") ||
      (column.type === "integer" && !Number.isSafeInteger(value)))
  )
    throw Error(`Invalid value for ${column.header}.`);
  if (cell?.allowed && !cell.allowed.includes(String(value ?? "")))
    throw Error(`Choose a permitted value for ${column.header}.`);
}
/** Field-level three-way merge. Source-owned formulas never become local facts by approval text. */
export function mergeSheetFields(
  base: Cells,
  local: Values,
  remote: Cells,
  mode = "two_way",
) {
  const values: Values = { ...local },
    baseline: Cells = { ...base },
    conflicts: Conflicts = {};
  for (const [key, r] of Object.entries(remote)) {
    const b = base[key]?.value ?? null,
      l = Object.hasOwn(local, key) ? local[key] : b;
    if (!r.writable) {
      if (!same(l, b) && !same(l, r.value))
        conflicts[key] = {
          base: b,
          local: l,
          remote: r.value,
          reason: "source_became_read_only",
        };
      else {
        values[key] = r.value;
        baseline[key] = r;
      }
    } else if (same(l, r.value)) {
      values[key] = r.value;
      baseline[key] = r;
    } else if (same(l, b) && mode !== "export_only") {
      values[key] = r.value;
      baseline[key] = r;
    } else if (same(r.value, b)) {
      baseline[key] = { ...r, value: b };
    } else
      conflicts[key] = {
        base: b,
        local: l,
        remote: r.value,
        reason: mode === "export_only" ? "external_edit" : "concurrent_edit",
      };
  }
  return { values, baseline, conflicts };
}
export function localPatch(base: Cells, values: Values, config: DatasetConfig) {
  return Object.fromEntries(
    config.columns
      .filter(
        (c) =>
          c.writable &&
          !c.key_part &&
          !same(base[c.key]?.value ?? null, values[c.key] ?? null),
      )
      .map((c) => [c.key, values[c.key] ?? null]),
  );
}
export function identityValues(config: DatasetConfig, values: Values) {
  return config.columns
    .filter((c) => c.key_part)
    .map((c) => {
      const v = values[c.key];
      if (v == null || String(v).trim() === "")
        throw Error("Every stable identity field needs a value.");
      return v;
    });
}
