/** A fulfilled promise is not proof that all of its work succeeded. */
export function workerOutcome(value: unknown): "completed" | "partial" {
  if (Array.isArray(value))
    return value.some((item) => workerOutcome(item) === "partial")
      ? "partial"
      : "completed";
  if (value && typeof value === "object") {
    const result = value as Record<string, unknown>;
    if (
      result.failed ||
      result.conflicts ||
      result.held_outbound ||
      ["partial", "failed", "blocked", "unknown"].includes(
        String(result.status),
      )
    )
      return "partial";
  }
  return "completed";
}
