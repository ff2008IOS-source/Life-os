import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { geminiRequest, parseGeminiReply } from "@/lib/assistant/gemini";

const src = (id: string, text = "x") => ({
  id,
  title: id,
  text,
  url: "https://canvas.sfu.ca/courses/1/files/2",
});

describe("Gemini weekly review", () => {
  it("sends the whole conversation as turns and records within budget", () => {
    const r = geminiRequest(
      "Make a study plan for ECON 115 Exam 3",
      [src("a", "a".repeat(100)), src("b", "b".repeat(100_000)), src("c")],
      [
        { role: "user", text: "How did the week go?" },
        { role: "model", text: "Good, PHIL paper submitted." },
      ],
      { now: "2026-11-27T20:00:00Z", timezone: "America/Vancouver" },
      2_000,
    );
    expect(r.body.contents.map((c) => c.role)).toEqual([
      "user",
      "model",
      "user",
    ]);
    // b is too big for the budget and is left out; a and c fit.
    expect(r.sources.map((s) => s.id)).toEqual(["a", "c"]);
    const last = JSON.parse(r.body.contents[2].parts[0].text);
    expect(last.message).toContain("study plan");
    expect(last.timezone).toBe("America/Vancouver");
    expect(r.body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("reads a reply, ignores thoughts and drops unknown citations", () => {
    const parsed = parseGeminiReply(
      {
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                { text: "thinking…", thought: true },
                {
                  text: JSON.stringify({
                    answer:
                      "## Plan\n| Day | Study |\n|---|---|\n| Fri | 45 min |",
                    source_ids: ["a", "made-up"],
                  }),
                },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 300 },
      },
      [src("a")],
    );
    expect(parsed.reply.answer).toContain("| Fri | 45 min |");
    expect(parsed.reply.source_ids).toEqual(["a"]);
    expect(parsed.input).toBe(1200);
  });

  it("accepts a plain-text answer and refuses a cut-off one", () => {
    expect(
      parseGeminiReply(
        {
          candidates: [
            {
              finishReason: "STOP",
              content: { parts: [{ text: "Sure — here's the plan." }] },
            },
          ],
        },
        [],
      ).reply.answer,
    ).toBe("Sure — here's the plan.");
    expect(() =>
      parseGeminiReply({ candidates: [{ finishReason: "MAX_TOKENS" }] }, []),
    ).toThrow(/ran out of room/);
  });
});
