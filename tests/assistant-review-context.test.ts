import { expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  ApiError: class extends Error {
    constructor(
      public status: number,
      msg: string,
    ) {
      super(msg);
    }
  },
}));
import {
  reviewContext,
  savedReviewContext,
} from "@/lib/assistant/review-context";
it("bounds owner-specific selected-week evidence across Vancouver DST and carries earlier commitments", async () => {
  const calls: URL[] = [];
  const client = createClient("https://fixture.invalid", "test-key", {
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        calls.push(url);
        expect(url.searchParams.get("user_id")).toBe("eq.owner");
        let data: unknown[] = [];
        if (url.pathname.endsWith("reviews"))
          data = url.searchParams.has("id")
            ? [
                {
                  period_start: "2025-10-27",
                  period_end: "2025-11-02",
                  achievements: "Original",
                  obstacles: "",
                  priorities: "",
                },
              ]
            : [
                {
                  period_start: "2026-10-19",
                  priorities: "Finish analysis",
                  decisions: "",
                  missed_commitments: "",
                  conversation_summary: "Reviewed reflection",
                  completed_at: null,
                },
              ];
        if (url.pathname.endsWith("assessments"))
          data = [
            {
              id: "before",
              course_id: "c",
              title: "Outside before",
              due_at: "2025-10-27T06:59:59Z",
            },
            {
              id: "start",
              course_id: "c",
              title: "At window start",
              due_at: "2025-10-27T07:00:00Z",
            },
            {
              id: "end",
              course_id: "c",
              title: "Before window end",
              due_at: "2025-11-10T07:59:59Z",
            },
            {
              id: "after",
              course_id: "c",
              title: "Outside after",
              due_at: "2025-11-10T08:00:00Z",
            },
            {
              id: "date",
              course_id: "c",
              title: "Date only",
              due_date: "2025-11-09",
            },
          ];
        if (url.pathname.endsWith("tasks"))
          data = [{ title: "Recorded task", actual_minutes: null }];
        return new Response(
          JSON.stringify(url.searchParams.has("id") ? data[0] : data),
          { headers: { "content-type": "application/json" } },
        );
      },
    },
  });
  const sources = await reviewContext(client, "owner", "review");
  expect(sources.find((s) => s.id === "review:week")!.text).toContain(
    "2025-10-27",
  );
  expect(sources.find((s) => s.id === "review:evidence")!.text).toContain(
    "Bounded examples",
  );
  expect(sources.find((s) => s.id === "review:carry")?.text).toContain(
    "Finish analysis",
  );
  const completed = calls.find((x) => x.searchParams.has("completed_at"))!;
  expect(completed.searchParams.getAll("completed_at")).toEqual([
    "gte.2025-10-27T07:00:00.000Z",
    "lt.2025-11-03T08:00:00.000Z",
  ]);
  const evidence = JSON.parse(
    sources.find((s) => s.id === "review:evidence")!.text,
  );
  expect(
    evidence.review_and_next_week_assessments.map(
      (a: { title: string }) => a.title,
    ),
  ).toEqual(["At window start", "Before window end", "Date only"]);
});

it("retrieves only the owner's completed review for general assistant recall and labels its limits", async () => {
  const client = createClient("https://fixture.invalid", "test-key", {
    global: {
      fetch: async (input) => {
        const u = new URL(String(input));
        expect(u.searchParams.get("user_id")).toBe("eq.owner");
        expect(u.searchParams.get("completed_at")).toBe("not.is.null");
        expect(u.searchParams.get("limit")).toBe("1");
        return new Response(
          JSON.stringify({
            id: "review",
            period_start: "2026-11-02",
            completed_at: "2026-11-08T12:00:00Z",
            achievements: "Owner note",
            missed_commitments: "",
            decisions: "",
            priorities: "Practice",
            conversation_summary: "Reviewed summary",
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    },
  });
  const [s] = await savedReviewContext(client, "owner");
  expect(s.text).toContain("Reviewed summary");
  expect(s.trust).toBe("owner_reflection_not_independent_evidence");
});
