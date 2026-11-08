import { describe, it, expect } from "vitest";
import { taskInput, goalInput, reviewInput } from "@/lib/schemas";
import { isOverdue, localDate, deadlineInstant } from "@/lib/dates";
import { goalProgress } from "@/lib/insights";
import type { Goal } from "@/lib/schemas";
describe("recorded-data semantics", () => {
  it("captures tasks with a title and no scheduling authorization", () => {
    const t = taskInput.parse({ title: "  [TEST] Next step  " });
    expect(t.title).toBe("[TEST] Next step");
    expect(t.scheduling_mode).toBe("manual");
    expect(t.due_at).toBeNull();
    expect(t.due_date).toBeNull();
  });
  it("keeps date-only deadlines current until Vancouver day ends", () => {
    const t = {
      due_date: "2026-11-06",
      due_at: null,
      status: "planned",
      deleted_at: null,
    };
    expect(isOverdue(t, new Date("2026-11-07T06:59:59Z"))).toBe(false);
    expect(isOverdue(t, new Date("2026-11-07T07:00:00Z"))).toBe(true);
    expect(deadlineInstant(t)?.toISOString()).toBe("2026-11-07T06:59:59.000Z");
  });
  it("handles local dates across DST rather than UTC dates", () => {
    expect(localDate("2025-03-09T07:59:00Z")).toBe("2025-03-08");
    expect(localDate("2025-03-09T10:00:00Z")).toBe("2025-03-09");
  });
  it("rejects double deadlines and missing numeric targets", () => {
    expect(
      taskInput.safeParse({
        title: "x",
        due_date: "2026-11-06",
        due_at: "2026-11-06T20:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      goalInput.safeParse({ title: "x", progress_type: "numeric" }).success,
    ).toBe(false);
  });
  it("does not manufacture numeric progress for qualitative goals or missing data", () => {
    const base = {
      id: "x",
      user_id: "x",
      version: 1,
      created_at: "",
      updated_at: "",
      ...goalInput.parse({
        title: "[TEST] Direction",
        progress_type: "qualitative",
      }),
    } as Goal;
    expect(goalProgress(base, []).percent).toBeNull();
    expect(
      goalProgress(
        {
          ...base,
          progress_type: "numeric",
          target_value: 20,
          current_value: null,
        },
        [],
      ).percent,
    ).toBeNull();
    expect(
      goalProgress({ ...base, progress_type: "milestone" }, []).percent,
    ).toBeNull();
  });
});

it("preserves review summaries when an older client omits the new field", () => {
  const input = reviewInput.parse({
    period_start: "2026-11-02",
    period_end: "2026-11-08",
  });
  expect(input.conversation_summary).toBeUndefined();
  expect(JSON.stringify(input)).not.toContain("conversation_summary");
  expect(
    reviewInput.parse({ ...input, conversation_summary: "" })
      .conversation_summary,
  ).toBe("");
});
