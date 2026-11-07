/** External cancellation/conflict holds outrank both task and project automation. */
export function schedulingEligible(
  task: { scheduling_mode: string; status: string; deleted_at?: string | null },
  project: { status: string; automation_enabled: boolean } | undefined,
  held: boolean,
) {
  return (
    !held &&
    !task.deleted_at &&
    !["completed", "cancelled"].includes(task.status) &&
    (task.scheduling_mode === "eligible" ||
      !!(project?.status === "active" && project.automation_enabled))
  );
}
