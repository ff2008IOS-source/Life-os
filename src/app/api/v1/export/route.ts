import { NextResponse } from "next/server";
import { authorized } from "@/lib/auth";
import { dbError, failure } from "@/lib/http";
const tables = [
  "profiles",
  "life_areas",
  "tasks",
  "projects",
  "goals",
  "milestones",
  "goal_tasks",
  "task_dependencies",
  "recurrence_rules",
  "task_occurrences",
  "reviews",
  "audit_logs",
  "data_sources",
  "import_batches",
  "calendar_connections",
  "calendars",
  "calendar_events",
  "scheduling_policies",
  "scheduling_automation",
  "work_blocks",
  "work_completions",
  "scheduling_runs",
  "scheduling_decisions",
  "integration_jobs",
  "sync_cursors",
  "integration_conflicts",
  "academic_terms",
  "courses",
  "grading_categories",
  "assessments",
  "study_topics",
  "study_sessions",
  "financial_accounts",
  "financial_categories",
  "transactions",
  "budgets",
  "savings_goals",
  "habits",
  "habit_entries",
  "contacts",
  "review_items",
  "notifications",
  "notification_preferences",
  "export_jobs",
  "deletion_requests",
  "goal_projects",
  "career_entries",
] as const;
export async function GET() {
  try {
    const { db, user } = await authorized();
    const records: Record<string, unknown[]> = {};
    for (const table of tables) {
      records[table] = [];
      let page = 0;
      while (true) {
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
        records[table].push(...(data ?? []));
        if (!data || data.length < 500) break;
        page++;
      }
    }
    return new NextResponse(
      JSON.stringify(
        {
          format: "life-os-user-export",
          version: 1,
          exported_at: new Date().toISOString(),
          warning:
            "User export only. Use an independent database backup for complete recovery; credentials and Auth are excluded. Export is not a transactionally consistent database snapshot.",
          records,
        },
        null,
        2,
      ),
      {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="life-os-export-${new Date().toISOString().slice(0, 10)}.json"`,
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (e) {
    return failure(e);
  }
}
