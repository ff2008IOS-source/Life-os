/** Presentation only: retain the underlying evidence and ranking rules. */
export function consumerReason(reason: string) {
  return reason
    .replace("No deadline recorded", "No deadline set")
    .replace("Recorded deadline has passed", "Past its deadline")
    .replace(/Importance (\d)\/4/, (_, n: string) =>
      Number(n) >= 3 ? "High priority" : "Personal priority",
    )
    .replace(
      /Academic work; verified assessment weight (\d+(?:\.\d+)?)%/,
      "Worth $1% of your course",
    )
    .replace(
      "Academic work; assessment consequence not quantified",
      "Course preparation",
    )
    .replace("Duration unknown", "Add a time estimate when you’re ready")
    .replace("estimated; actual effort not recorded", "estimated")
    .replace("remaining from recorded effort", "remaining")
    .replace(
      "Calendar availability unknown",
      "Update your calendar to check available time",
    )
    .replace("Fits a recorded free window", "Fits your available time")
    .replace(
      "Needs splitting or another work window",
      "Try a shorter session or a different time",
    )
    .replace(/(\d+) recorded deferrals/, "Put off $1 times");
}
