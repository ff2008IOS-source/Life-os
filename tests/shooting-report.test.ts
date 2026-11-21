import { expect, it } from "vitest";
import { shootingReport, reportCsv } from "@/lib/shooting-report";
import type { Dataset, Row } from "@/components/sheet-rest-panel";
const dataset = {
  config: {
    columns: [
      { key: "player", header: "Player", key_part: true },
      { key: "made", header: "Made" },
      { key: "attempts", header: "Attempts" },
    ],
  },
} as Dataset;
const row = (
  id: string,
  player: string,
  made: number | null,
  attempts: number | null,
) =>
  ({
    id,
    version: 1,
    remote_cells: {},
    baseline: {},
    conflicts: {},
    row_locator: 1,
    local_values: { player, made, attempts },
    state: "synced",
  }) as Row;
it("calculates accuracy from real attempts and distinguishes zero attempts", () => {
  const report = shootingReport(dataset, [
    row("1", "Player A", 7, 10),
    row("2", "Player B", 0, 0),
  ])!;
  expect(report).toMatchObject({
    made: 7,
    attempts: 10,
    accuracy: 70,
    valid: true,
  });
  expect(report.items[1].accuracy).toBeNull();
});
it("rejects invalid counts, pending changes and duplicate source identity from totals", () => {
  for (const rows of [
    [row("1", "A", 11, 10)],
    [row("1", "A", null, 10)],
    [row("1", "A", 2, 10), row("2", "A", 3, 10)],
    [{ ...row("1", "A", 1, 2), state: "pending" }],
  ]) {
    const report = shootingReport(dataset, rows)!;
    expect(report.valid).toBe(false);
    expect(report.made).toBeNull();
  }
});
it("escapes spreadsheet formulas and preserves CSV quoting", () => {
  const csv = reportCsv([
    { player: '=SUM(1,2)"', made: 1, attempts: 2, accuracy: 50 },
  ]);
  expect(csv).toContain('"\'=SUM(1,2)"""');
  expect(csv).toContain('"50.0"');
});

it("also escapes formulas preceded by whitespace in player names", () => {
  const csv = reportCsv([
    { player: "\t =1+2", made: 1, attempts: 2, accuracy: 50 },
  ]);
  expect(csv).toContain('"\'\t =1+2"');
});
