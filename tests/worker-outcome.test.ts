import { describe, expect, it } from "vitest";
import { workerOutcome } from "@/lib/worker-outcome";
describe("truthful worker summaries", () => {
  it.each([
    { failed: 1 },
    [{ failed: true }],
    [{ held_outbound: true }],
    [{ conflicts: 2 }],
    { status: "unknown" },
  ])("does not mark unresolved work completed: %j", (value) => {
    expect(workerOutcome(value)).toBe("partial");
  });
  it("keeps successful and empty workers successful", () => {
    expect(workerOutcome({ failed: 0, checked: 0 })).toBe("completed");
    expect(workerOutcome([])).toBe("completed");
  });
});
