import {
  same,
  type Values,
  type Cells,
  type DatasetConfig,
} from "./sheet-ledger-model";
import { blankRestRow, type TableSnapshot } from "./sheet-rest-snapshot";
import { a1Range } from "./sheets-rest-provider";
export type WriteIntent = {
  operation_type: "update" | "insert" | "delete";
  intended: Values;
  expected_cells: Cells;
  external_key: string;
  uncertain?: boolean;
};
/** Re-resolve identity on every attempt. No stale row location is ever reused. */
export function planRestWrite(snapshot: TableSnapshot, intent: WriteIntent) {
  const record = snapshot.rows.find(
    (r) => r.external_key === intent.external_key,
  );
  const entries = Object.entries(intent.intended);
  if (intent.operation_type === "delete" && !record)
    return { converged: true, changes: [], row: null };
  if (
    intent.operation_type !== "delete" &&
    record &&
    entries.every(([k, v]) => same(record.values[k], v))
  )
    return { converged: true, changes: [], row: record.row_locator };
  if (intent.uncertain)
    throw Error(
      "An uncertain write differs from its intended values. Review the source before retrying.",
    );
  if (intent.operation_type === "insert" && record)
    throw Error("This stable source identity already exists.");
  if (intent.operation_type !== "insert" && !record)
    throw Error("The source record is missing. History was preserved.");
  const row = record?.row_locator ?? blankRestRow(snapshot);
  const changes: { range: string; value: Values[string] }[] = [];
  const config: DatasetConfig = snapshot.config;
  for (const [key, value] of entries) {
    const column = config.columns.find((c) => c.key === key);
    if (!column) throw Error("Unmapped field.");
    if (
      intent.operation_type === "update" &&
      (!column.writable || column.key_part)
    )
      throw Error("This field is source-owned.");
    const cell = snapshot.cell(row, snapshot.positions[key]);
    if (!cell.source_writable)
      throw Error(
        "A formula, protected range or unsupported validation prevents this write.",
      );
    if (record && !same(cell.value, intent.expected_cells[key]?.value ?? null))
      throw Error("The source changed since approval. Review both values.");
    if (!same(cell.value, value))
      changes.push({
        range: a1Range(snapshot.title, row, snapshot.positions[key]),
        value,
      });
  }
  if (intent.operation_type === "delete") {
    // Delete means clear the entire bounded table row, never shift unrelated rows or erase formulas.
    for (let col = config.start_column; col < config.end_column; col++) {
      if (
        !Object.values(snapshot.positions).includes(col) &&
        snapshot.cell(row, col).value !== null
      )
        throw Error("Deletion would affect an unmapped field.");
      if (!snapshot.cell(row, col).source_writable)
        throw Error("Deletion would affect a formula or protected cell.");
    }
  }
  return { converged: changes.length === 0, changes, row };
}
