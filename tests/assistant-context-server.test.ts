import { it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/canvas/documents-server", () => ({
  ensureCanvasDocument: async () => ({ known_files: 0, truncated: false }),
}));
import { createClient } from "@supabase/supabase-js";
import { assistantAcademicContext } from "../src/lib/assistant/context-server";
import { boundedPrompt } from "../src/lib/assistant/provider";
it("retrieves owned assessments across courses into the actual provider prompt without a course choice", async () => {
  const calls: URL[] = [];
  const transport = vi.fn(async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    if (u.pathname.includes("/rpc/"))
      return new Response("[]", {
        headers: { "Content-Type": "application/json" },
      });
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

it("relinks an imported exam to its Canvas course and retrieves scope from a body with an unhelpful title", async () => {
  const calls: URL[] = [];
  const db = createClient("https://synthetic.invalid", "synthetic-public-key", {
    auth: { persistSession: false },
    global: {
      fetch: async (input) => {
        const u = new URL(String(input));
        if (u.pathname.includes("/rpc/"))
          return new Response(
            JSON.stringify([
              {
                file_id: "7",
                chunk_index: 2,
                page: 3,
                title: "Current syllabus.pdf",
                text: "[TEST] Retrieved PDF text: the exam scope is chapters 7 and 8.",
                extracted_at: "2026-11-07T12:00:00Z",
                truncated: false,
              },
            ]),
            {
              headers: { "Content-Type": "application/json" },
            },
          );
        calls.push(u);
        let data: unknown[] = [];
        if (u.pathname.endsWith("/courses"))
          data = [
            { id: "native-econ", code: "ECON 115", title: "Macroeconomics" },
          ];
        if (u.pathname.endsWith("/assessments"))
          data = [
            {
              id: "exam",
              course_id: "native-econ",
              title: "Exam 2",
              due_at: null,
              due_date: "2099-11-13",
              verification_status: "unverified",
              source_key: "original-sheet",
            },
          ];
        if (u.pathname.endsWith("/canvas_records")) {
          const type = u.searchParams.get("resource_type");
          if (type === "eq.course")
            data = [
              {
                canvas_id: "16929",
                payload: { course_code: "ECON115 D100" },
                synced_at: "2026-11-07T08:00Z",
              },
            ];
          if (type === "eq.page_content")
            data = [
              {
                resource_type: "page_content",
                canvas_id: "16929:page",
                payload: {
                  title: "Course information",
                  body:
                    "Welcome. ".repeat(250) +
                    "Exam 2 covers chapters 7 and 8. This is the current exam scope.",
                },
                synced_at: "2026-11-07T08:00Z",
              },
            ];
        }
        return new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  });
  const sources = await assistantAcademicContext(
    db,
    "owner-test",
    "What topics are on my next midterm?",
    "",
    null,
  );
  expect(
    calls.some(
      (u) =>
        u.searchParams.get("resource_type") === "eq.page_content" &&
        u.searchParams.get("course_canvas_id") === "eq.16929",
    ),
  ).toBe(true);
  expect(sources.some((s) => s.text.includes("covers chapters 7 and 8"))).toBe(
    true,
  );
  expect(
    sources.some((s) => s.text.includes("UNVERIFIED imported record")),
  ).toBe(true);
  expect(
    sources.some(
      (s) =>
        s.id === "canvas:document:16929:7:3:2" && s.url?.endsWith("/files/7"),
    ),
  ).toBe(true);
  const { prepareGroqRequest } = await import("../src/lib/assistant/provider");
  const prompt = prepareGroqRequest(
    "What topics are on my next midterm?",
    sources,
  );
  expect(JSON.stringify(prompt.request.messages)).toContain(
    "[TEST] Retrieved PDF text",
  );
  expect(JSON.stringify(prompt.request.messages)).toContain(
    "covers chapters 7 and 8",
  );
});
