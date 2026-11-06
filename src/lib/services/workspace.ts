import "server-only";
import { authorized } from "@/lib/auth";
import { dbError } from "@/lib/http";
import type { Workspace } from "@/lib/schemas";
export async function loadWorkspace(): Promise<Workspace> {
  const { db, user } = await authorized();
  const tables = [
    "tasks",
    "projects",
    "goals",
    "milestones",
    "reviews",
    "life_areas",
    "profiles",
    "task_dependencies",
    "goal_tasks",
    "recurrence_rules",
    "task_occurrences",
  ] as const;
  const results = await Promise.all(
    tables.map(async (table) => {
      const rows: Record<string, unknown>[] = [];
      for (let page = 0; page < 20; page++) {
        const key =
          table === "profiles"
            ? "user_id"
            : table === "goal_tasks"
              ? "goal_id"
              : table === "task_dependencies"
                ? "predecessor_task_id"
                : "id";
        let query = db
          .from(table)
          .select("*")
          .eq("user_id", user.id)
          .order(key);
        if (table === "goal_tasks") query = query.order("task_id");
        if (table === "task_dependencies")
          query = query.order("successor_task_id");
        const { data, error } = await query.range(page * 500, page * 500 + 499);
        dbError(error);
        rows.push(...(data ?? []));
        if (!data || data.length < 500) return rows;
      }
      throw new Error(
        "This collection exceeds the beta workspace loading limit. Use the export or paginated API; no truncated totals are shown.",
      );
    }),
  );
  const [
    tasks,
    projects,
    goals,
    milestones,
    reviews,
    areas,
    profiles,
    dependencies,
    goalTasks,
    recurrences,
    occurrences,
  ] = results;
  return {
    tasks,
    projects,
    goals,
    milestones,
    reviews,
    areas,
    profile: profiles[0] ?? {
      display_name: "",
      timezone: "America/Vancouver",
      theme: "dark",
      density: "comfortable",
      version: 1,
    },
    dependencies,
    goalTasks,
    recurrences,
    occurrences,
  } as Workspace;
}
