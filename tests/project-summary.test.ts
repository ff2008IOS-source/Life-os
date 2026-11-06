import { describe, it, expect } from "vitest";
import { projectSummary } from "../src/lib/project-summary";
describe("project card copy", () => {
  it("respects a concise description edited by the owner", () => {
    expect(
      projectSummary("NBA content channel", "My revised description.", true),
    ).toBe("My revised description.");
  });
  it("summarizes an imported deliverable without exposing its source URL or audit boilerplate", () => {
    const s = projectSummary(
      "NBA GM/CBA content channel and first transaction analysis",
      "Activated from source status In Progress\nhttps://docs.google.com/" +
        "x".repeat(1000),
      true,
    );
    expect(s).toBe(
      "Launch an NBA front-office analysis channel with a first transaction breakdown.",
    );
    expect(s).not.toContain("http");
  });
  it("bounds ordinary descriptions and strips long links", () => {
    expect(
      projectSummary(
        "Example",
        "Useful work. https://example.com/" + "x".repeat(1000),
      ),
    ).toBe("Useful work.");
    expect(
      projectSummary("Example", "A long descriptive sentence. ".repeat(30))
        .length,
    ).toBeLessThanOrEqual(155);
  });
});
