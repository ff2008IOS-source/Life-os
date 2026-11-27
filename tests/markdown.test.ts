import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "@/components/markdown";

const html = (t: string) => renderToStaticMarkup(Markdown({ text: t }));

describe("AI answer formatting", () => {
  it("renders headings, lists, tables and safe links", () => {
    const out = html(
      "## Day-by-day plan\n\n| Day | Study |\n|---|---|\n| **Fri** | 45 min |\n\n- Slides [here](https://canvas.sfu.ca/x)\n- Bad [link](javascript:alert(1))",
    );
    expect(out).toContain("<h3>Day-by-day plan</h3>");
    expect(out).toContain("<table>");
    expect(out).toContain("<strong>Fri</strong>");
    expect(out).toContain('href="https://canvas.sfu.ca/x"');
    expect(out).not.toContain("javascript:");
  });
  it("never passes raw HTML through", () => {
    expect(html("<img src=x onerror=alert(1)>")).not.toContain("<img");
  });
});
