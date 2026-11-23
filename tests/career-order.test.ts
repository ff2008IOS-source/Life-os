import { it, expect } from "vitest";
import { careerGroup, orderCareerRows, termKey } from "@/lib/career-order";
const id = (s: string) => s;
it("orders years and terms the way they happen", () => {
  expect(orderCareerRows(["Year 3", "Year 4", "Year 1", "Year 2"], id)).toEqual(
    ["Year 1", "Year 2", "Year 3", "Year 4"],
  );
  expect(
    orderCareerRows(
      [
        "Spring 2029 · Co-op · Complete formal co-op",
        "Fall 2026 · Skill · Learn Excel foundations",
        "Spring 2027 · Beedie · Complete quantitative prerequisite",
        "Fall 2026 · Career · Speak with Kaden",
      ],
      id,
    ),
  ).toEqual([
    "Fall 2026 · Skill · Learn Excel foundations",
    "Fall 2026 · Career · Speak with Kaden",
    "Spring 2027 · Beedie · Complete quantitative prerequisite",
    "Spring 2029 · Co-op · Complete formal co-op",
  ]);
  expect(
    orderCareerRows(
      ["Spring 2028", "Spring 2029", "Spring 2030", "Spring 2027"],
      id,
    ),
  ).toEqual(["Spring 2027", "Spring 2028", "Spring 2029", "Spring 2030"]);
  expect(termKey("Winter 2027")! < termKey("Spring 2027")!).toBe(true);
});
it("puts the newest dated row first and keeps others in sheet order", () => {
  expect(
    orderCareerRows(
      ["Aug 17, 2026", "Jan 4, 2027", "Sep 7, 2026", "NBA CBA", "Excel"],
      id,
    ),
  ).toEqual(["Jan 4, 2027", "Sep 7, 2026", "Aug 17, 2026", "NBA CBA", "Excel"]);
});
it("groups plan tables into tabs", () => {
  expect(careerGroup("Four-year roadmap")).toBe("plan");
  expect(careerGroup("Semester priorities")).toBe("plan");
  expect(careerGroup("Internship roadmap")).toBe("plan");
  expect(careerGroup("Career skills")).toBe("skills");
  expect(careerGroup("Career portfolio statuses")).toBe("skills");
  expect(careerGroup("Application pipeline")).toBe("network");
  expect(careerGroup("Professional contacts")).toBe("network");
  expect(careerGroup("Weekly reflections")).toBe("reflections");
  expect(careerGroup("Something else")).toBe("other");
});
