import { it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createClient } from "@supabase/supabase-js";
import { assistantAcademicContext } from "../src/lib/assistant/context-server";
import { boundedPrompt } from "../src/lib/assistant/provider";
it("retrieves owned assessments across courses into the actual provider prompt without a course choice", async () => {
  const calls: URL[] = [];
  const transport = vi.fn(async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    calls.push(u);
    let data: unknown[] = [];
    if (u.pathname.endsWith("/courses"))
      data = [{ id: "native", code: "GEOG104", title: "Geography" }];
    if (u.pathname.endsWith("/canvas_records")) {
      const type = u.searchParams.get("resource_type");
      if (type === "eq.course")
        data = [
          {
            canvas_id: "55",
            payload: { course_code: "GEOG104 OL01", name: "Geography" },
            synced_at: "2026-11-07T08:00Z",
          },
        ];
      if (type === "eq.assignment")
        data = [
          {
            canvas_id: "55:99",
            course_canvas_id: "55",
            payload: {
              id: 99,
              name: "Knowledge Test #2",
              due_at: "2099-11-09T06:59:59Z",
              description: "<p>Covers chapters 3 and 4.</p>",
              published: true,
            },
            synced_at: "2026-11-07T08:00Z",
          },
        ];
    }
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  });
  const db = createClient("https://synthetic.invalid", "synthetic-public-key", {
    global: { fetch: transport },
    auth: { persistSession: false },
  });
  const sources = await assistantAcademicContext(
    db,
    "owner-test",
    "What's on my next exam?",
    "",
    null,
  );
  const prompt = boundedPrompt("What's on my next exam?", sources);
  expect(prompt.messages[1].content).toContain("Knowledge Test #2");
  expect(prompt.messages[1].content).toContain("chapters 3 and 4");
  expect(
    calls.every((u) => u.searchParams.get("user_id") === "eq.owner-test"),
  ).toBe(true);
  expect(
    calls.some(
      (u) =>
        u.searchParams.get("resource_type") === "eq.assignment" &&
        !u.searchParams.has("course_canvas_id"),
    ),
  ).toBe(true);
});
