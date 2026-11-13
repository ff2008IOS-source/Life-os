import { expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { reviewCommitments } from "@/lib/review-commitments";
it("carries unfinished approved tasks once, keeps current completions, and excludes examples", async () => {
  const rows: Record<string, unknown[]> = {
    reviews: [
      { id: "current", period_start: "2026-11-09" },
      { id: "previous", period_start: "2026-11-02" },
    ],
    review_items: [
      { id: "one", review_id: "current", task_id: "done" },
      { id: "two", review_id: "previous", task_id: "open" },
      { id: "three", review_id: "previous", task_id: "done" },
      { id: "four", review_id: "previous", task_id: "sample" },
      { id: "five", review_id: "previous", task_id: "closed" },
    ],
    tasks: [
      { id: "done", status: "completed" },
      { id: "open", status: "in_progress" },
      { id: "sample", source_type: "test", status: "planned" },
      { id: "closed", status: "cancelled" },
    ],
  };
  const db = createClient("https://fixture.invalid", "synthetic", {
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        expect(url.searchParams.get("user_id")).toBe("eq.owner");
        return Response.json(rows[url.pathname.split("/").at(-1)!] ?? []);
      },
    },
  });
  const result = await reviewCommitments(db, "owner", "2026-11-09");
  expect(result.items.map((x) => [x.task.id, x.carried])).toEqual([
    ["done", false],
    ["open", true],
  ]);
  expect(result.incomplete).toBe(false);
});
