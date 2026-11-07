import { describe, it, expect } from "vitest";
import { vancouverInputInstant } from "../src/lib/local-time-input";
import { workCompletionInput } from "../src/lib/work-session";
describe("honest actual-time and effort inputs", () => {
  it("converts Vancouver inputs independently of browser timezone", () => {
    expect(vancouverInputInstant("2026-11-06T09:00")).toBe(
      "2026-11-06T16:00:00.000Z",
    );
    expect(vancouverInputInstant("")).toBe(null);
  });
  it("rejects nonexistent historical clock times and preserves an unchanged ambiguous timestamp", () => {
    expect(() => vancouverInputInstant("2025-03-09T02:30")).toThrow();
    expect(
      vancouverInputInstant("2025-11-02T01:30", "2025-11-02T09:30:00Z"),
    ).toBe("2025-11-02T09:30:00Z");
  });
  it("requires real reported effort, allows unknown times and rejects half a time range", () => {
    const input = {
      request_id: "11111111-1111-4111-8111-111111111111",
      version: 1,
      actual_minutes: 35,
    };
    expect(workCompletionInput.parse(input).actual_start_at).toBe(null);
    expect(() =>
      workCompletionInput.parse({ ...input, actual_minutes: 0 }),
    ).toThrow();
    expect(() =>
      workCompletionInput.parse({
        ...input,
        actual_start_at: "2026-11-06T17:00:00Z",
      }),
    ).toThrow();
  });
});
