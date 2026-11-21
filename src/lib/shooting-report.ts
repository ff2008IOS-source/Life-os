import type { Dataset, Row } from "@/components/sheet-rest-panel";
const match = (d: Dataset, pattern: RegExp) =>
  d.config.columns.find((c) => pattern.test(c.header.trim()));
export function shootingColumns(d: Dataset) {
  const player = match(d, /^(player|player name|athlete)$/i),
    made = match(d, /^(made|makes|shots made)$/i),
    attempts = match(d, /^(attempts|attempted|shots attempted)$/i);
  return player && made && attempts ? { player, made, attempts } : null;
}
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim())
      ? Number(value)
      : null;
export function shootingReport(dataset: Dataset, rows: Row[]) {
  const columns = shootingColumns(dataset);
  if (!columns) return null;
  const keys = dataset.config.columns.filter((c) => c.key_part);
  const seen = new Set<string>();
  const items = rows
    .filter((r) => !["deleted", "remote_deleted"].includes(r.state))
    .map((r) => {
      const player = String(r.local_values[columns.player.key] ?? ""),
        made = number(r.local_values[columns.made.key]),
        attempts = number(r.local_values[columns.attempts.key]);
      const identity = keys.length
        ? JSON.stringify(keys.map((k) => r.local_values[k.key]))
        : r.id;
      const duplicate = seen.has(identity);
      seen.add(identity);
      const issue = duplicate
        ? "Duplicate source identity"
        : r.state !== "synced"
          ? "Source changes need review"
          : !player.trim()
            ? "Player not recorded"
            : made === null || attempts === null
              ? "Counts not recorded"
              : !Number.isInteger(made) ||
                  !Number.isInteger(attempts) ||
                  made < 0 ||
                  attempts < 0 ||
                  made > attempts
                ? "Check counts"
                : null;
      return {
        id: r.id,
        player: player || "Not recorded",
        made,
        attempts,
        accuracy: !issue && attempts ? (made! / attempts) * 100 : null,
        issue,
      };
    });
  const valid = items.length > 0 && items.every((r) => !r.issue);
  const made = valid ? items.reduce((n, r) => n + r.made!, 0) : null,
    attempts = valid ? items.reduce((n, r) => n + r.attempts!, 0) : null;
  return {
    items,
    made,
    attempts,
    accuracy: attempts ? (made! / attempts) * 100 : null,
    valid,
  };
}
/** Spreadsheet applications must not execute text values from an exported report. */
export function reportCsv(
  rows: {
    player: string;
    made: number | null;
    attempts: number | null;
    accuracy: number | null;
  }[],
) {
  const cell = (v: unknown) =>
    '"' +
    String(v ?? "")
      .replace(/^\s*[=+@\-]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  return [
    ["Player", "Made", "Attempts", "Accuracy (%)"],
    ...rows.map((r) => [
      r.player,
      r.made,
      r.attempts,
      r.accuracy === null ? null : r.accuracy.toFixed(1),
    ]),
  ]
    .map((r) => r.map(cell).join(","))
    .join("\r\n");
}
