import { it, expect } from "vitest";
import {
  deadlineStatusLabel,
  canvasAssignmentLink,
} from "../src/lib/canvas/deadline-status";
it("does not equate past deadlines or grading with assignment submission", () => {
  expect(deadlineStatusLabel("unknown", true)).toBe(
    "Past due · status unknown",
  );
  expect(deadlineStatusLabel("graded", true)).toBe(
    "Graded · submission not confirmed",
  );
  expect(deadlineStatusLabel("missing", true)).toBe("Canvas reports missing");
  expect(deadlineStatusLabel("submitted", true)).toBe("Submitted");
  expect(deadlineStatusLabel("needs_review", false)).toContain("Conflicting");
});
it("links only a matching numeric Canvas course and assignment identity", () => {
  expect(canvasAssignmentLink("123", "123:456")).toBe(
    "https://canvas.sfu.ca/courses/123/assignments/456",
  );
  expect(canvasAssignmentLink("123", "999:456")).toBeNull();
  expect(canvasAssignmentLink("123", "123:javascript:1")).toBeNull();
});
