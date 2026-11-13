import type { Workspace } from "./schemas";
type ExampleRecord = { is_example?: boolean; source_type?: string };
export function isExample(record: ExampleRecord) {
  return record.is_example === true || record.source_type === "test";
}
/** Keep examples in their editing screens, but out of real decisions and totals. */
export function realWorkspace(workspace: Workspace): Workspace {
  const tasks = workspace.tasks.filter((x) => !isExample(x));
  const taskIds = new Set(tasks.map((x) => x.id));
  const projects = workspace.projects.filter((x) => !isExample(x));
  const projectIds = new Set(projects.map((x) => x.id));
  const goals = workspace.goals.filter((x) => !isExample(x));
  const goalIds = new Set(goals.map((x) => x.id));
  return {
    ...workspace,
    tasks,
    projects,
    goals,
    occurrences: workspace.occurrences.filter((x) => taskIds.has(x.task_id)),
    goalTasks: workspace.goalTasks.filter(
      (x) => goalIds.has(x.goal_id) && taskIds.has(x.task_id),
    ),
    milestones: workspace.milestones.filter(
      (x) =>
        (!x.goal_id || goalIds.has(x.goal_id)) &&
        (!x.project_id || projectIds.has(x.project_id)),
    ),
  };
}
