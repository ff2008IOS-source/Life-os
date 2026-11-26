import { describe, expect, it } from "vitest";
import { matchCourse, plainText, updateFlags } from "@/lib/course-updates";

const courses = [
  { id: "e115", code: "ECON 115" },
  { id: "e113", code: "ECON 113" },
  { id: "phil", code: "PHIL 100W" },
];

describe("course updates", () => {
  it("flags grading, schedule and mark changes", () => {
    expect(updateFlags("Exam 3 moved to December 9", "")).toEqual(["schedule"]);
    expect(
      updateFlags(
        "Update",
        "The final will now be worth 45% and we will drop the lowest quiz.",
      ),
    ).toEqual(["grading"]);
    expect(
      updateFlags("Exam 2 results are now available in Crowdmark", ""),
    ).toEqual(["mark"]);
    expect(updateFlags("Reminder: office hours", "See you Thursday")).toEqual(
      [],
    );
  });
  it("matches a course code in any common form", () => {
    expect(matchCourse("[ECON-115] Exam 2 graded", courses)).toBe("e115");
    expect(matchCourse("Econ115 tutorial cancelled", courses)).toBe("e115");
    expect(matchCourse("PHIL 100W paper", courses)).toBe("phil");
    expect(matchCourse("ECON 1150 notes", courses)).toBeNull();
    expect(
      matchCourse("ECON 113 and ECON 115 joint review", courses),
    ).toBeNull();
  });
  it("turns HTML into readable text", () => {
    expect(plainText("<p>Exam&nbsp;moved</p><p>to <b>Dec 9</b></p>")).toBe(
      "Exam moved\nto Dec 9",
    );
  });
});
