import { describe, expect, it } from "vitest";
import { orderTerms, visibleCourses } from "@/lib/course-visibility";

// Mirrors the real workspace: Canvas files SFU 101 under an undated
// "Default Term" and every other course under Fall 2026.
const terms = [
  { id: "default", name: "Default Term", created_at: "2026-11-07" },
  { id: "fall", name: "Fall 2026", created_at: "2026-11-06" },
];
const codes = ["ECON 113", "PSYC 100", "ECON 115", "GEOG 104", "PHIL 100W"];
const courses = [
  ...codes.map((code) => ({ id: code, code, term_id: "fall" })),
  { id: "SFU 101", code: "SFU 101", term_id: "default" },
];
const shown = (r: { courses: { id: string }[] }) => r.courses.map((c) => c.id);

describe("School course visibility", () => {
  it("shows all six active courses by default, ECON 113 and 115 included", () => {
    const r = visibleCourses(terms, courses, null);
    expect(r.term).toBe("fall");
    expect(shown(r)).toEqual(expect.arrayContaining([...codes, "SFU 101"]));
    expect(shown(r)).toHaveLength(6);
  });
  it("keeps undated-term courses when a semester is picked", () => {
    expect(shown(visibleCourses(terms, courses, "fall"))).toContain("SFU 101");
  });
  it("shows only the undated term when it is picked on its own", () => {
    expect(shown(visibleCourses(terms, courses, "default"))).toEqual([
      "SFU 101",
    ]);
  });
  it("opens on a linked course's term", () => {
    expect(shown(visibleCourses(terms, courses, null, "ECON 115"))).toContain(
      "ECON 115",
    );
  });
  it("shows every course when no term is a named semester", () => {
    const plain = [
      { id: "a", name: "[TEST] term A" },
      { id: "b", name: "[TEST] term B" },
    ];
    const cs = [
      { id: "x", term_id: "a" },
      { id: "y", term_id: "b" },
    ];
    expect(shown(visibleCourses(plain, cs, null))).toEqual(["x", "y"]);
  });
  it("puts a new semester first once Canvas adds it", () => {
    const next = [...terms, { id: "spring", name: "Spring 2027" }];
    expect(orderTerms(next)[0].id).toBe("spring");
    const r = visibleCourses(
      next,
      [...courses, { id: "N", term_id: "spring" }],
      null,
    );
    expect(r.term).toBe("spring");
    expect(shown(r)).toEqual(["SFU 101", "N"]);
  });
});
