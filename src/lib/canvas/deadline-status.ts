export function deadlineStatusLabel(state: string, pastDue: boolean) {
  if (state === "submitted") return "Submitted";
  if (state === "graded") return "Graded · submission not confirmed";
  if (state === "excused") return "Excused";
  if (state === "needs_review") return "Conflicting Canvas status · verify";
  if (state === "missing") return "Canvas reports missing";
  if (state === "unsubmitted")
    return pastDue ? "Past due · unsubmitted" : "Not submitted";
  return pastDue ? "Past due · status unknown" : "Submission status unknown";
}
export function canvasAssignmentLink(course: string, identity: string) {
  const parts = identity.split(":");
  return /^\d+$/.test(course) &&
    parts.length === 2 &&
    parts[0] === course &&
    /^\d+$/.test(parts[1])
    ? `https://canvas.sfu.ca/courses/${course}/assignments/${parts[1]}`
    : null;
}
