import { it, expect } from "vitest";
import { canvasHealth } from "../src/lib/canvas/health";
it("does not describe a denied optional index as a stale academic feed", () => {
  const now = Date.now();
  const base = {
    last_success_at: new Date(now).toISOString(),
    interval_minutes: 60,
    next_url: null,
  };
  expect(
    canvasHealth(
      [
        { ...base, resource_type: "assignment", last_error: null },
        {
          ...base,
          resource_type: "page",
          last_error: "Canvas does not permit this resource (Canvas HTTP 403)",
          last_success_at: null,
        },
      ],
      now,
    ),
  ).toMatchObject({ restricted_count: 1, academic_stale_count: 0 });
});
it("keeps actual failed or old academic jobs visible", () => {
  const now = Date.now();
  const h = canvasHealth(
    [
      {
        resource_type: "assignment",
        last_error: "timeout",
        last_success_at: null,
        interval_minutes: 60,
        next_url: null,
      },
    ],
    now,
  );
  expect(h.academic_stale_count).toBe(1);
  expect(h.retry_error_count).toBe(1);
});
