import { createHash } from "node:crypto";
export type SheetMapping = {
  idColumn: string;
  columns: Record<string, string>;
};
export function inspectSheet(headers: unknown[]) {
  const names = headers.map((h) => String(h ?? "").trim());
  if (names.some((n) => !n) || new Set(names).size !== names.length)
    throw Error("Headers must be nonempty and unique before mapping");
  return {
    headers: names,
    fingerprint: createHash("sha256")
      .update(JSON.stringify(names))
      .digest("hex"),
  };
}
export function mapSheetRows(input: {
  spreadsheetId: string;
  sheetId: number;
  headers: unknown[];
  rows: unknown[][];
  mapping: SheetMapping;
  expectedFingerprint: string;
}) {
  const actual = inspectSheet(input.headers);
  if (actual.fingerprint !== input.expectedFingerprint)
    throw Error("Spreadsheet schema changed. Revalidate the mapping.");
  const required = [
    input.mapping.idColumn,
    ...Object.values(input.mapping.columns),
  ];
  if (required.some((c) => !actual.headers.includes(c)))
    throw Error("A mapped source column is missing");
  const seen = new Set<string>();
  const records: Record<string, unknown>[] = [];
  const errors: { row: number; message: string }[] = [];
  input.rows.forEach((row, index) => {
    if (row.every((v) => v === null || v === undefined || v === "")) return;
    const id = String(
      row[actual.headers.indexOf(input.mapping.idColumn)] ?? "",
    ).trim();
    if (!id) {
      errors.push({
        row: index + 2,
        message:
          "Missing stable source identifier. Row numbers are not stable IDs.",
      });
      return;
    }
    if (seen.has(id)) {
      errors.push({ row: index + 2, message: "Duplicate source identifier" });
      return;
    }
    seen.add(id);
    const record: Record<string, unknown> = {
      source_key: JSON.stringify([input.spreadsheetId, input.sheetId, id]),
    };
    for (const [field, column] of Object.entries(input.mapping.columns)) {
      if (
        ["__proto__", "constructor", "prototype", "source_key"].includes(field)
      )
        throw Error("Invalid target field");
      record[field] = row[actual.headers.indexOf(column)] ?? null;
    }
    records.push(record);
  });
  return { records, errors, fingerprint: actual.fingerprint };
}
