export type CanvasJobHealth = {
  resource_type: string;
  last_error: string | null;
  last_success_at: string | null;
  interval_minutes: number;
  next_url: string | null;
};
export function canvasHealth(jobs: CanvasJobHealth[], now = Date.now()) {
  const critical = new Set([
    "course",
    "assignment",
    "submission",
    "enrollment",
    "assignment_group",
    "calendar_event",
  ]);
  const restricted = jobs.filter((j) =>
    /Canvas HTTP (403|404|406)/.test(j.last_error ?? ""),
  );
  const retry = jobs.filter((j) => j.last_error && !restricted.includes(j));
  const academicStale = jobs.filter(
    (j) =>
      critical.has(j.resource_type) &&
      (!j.last_success_at ||
        !!j.last_error ||
        now - Date.parse(j.last_success_at) > j.interval_minutes * 90000),
  );
  const materialsPending = jobs.filter(
    (j) =>
      !critical.has(j.resource_type) &&
      !restricted.includes(j) &&
      (!j.last_success_at ||
        !!j.next_url ||
        now - Date.parse(j.last_success_at) > j.interval_minutes * 90000),
  );
  return {
    restricted_count: restricted.length,
    retry_error_count: retry.length,
    academic_stale_count: academicStale.length,
    material_backlog_count: materialsPending.length,
  };
}
