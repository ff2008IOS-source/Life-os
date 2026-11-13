import { NextResponse } from "next/server";
import { authorized } from "@/lib/auth";
import { dbError, failure } from "@/lib/http";
const tables = [
  "profiles",
  "briefing_settings",
  "briefing_actions",
  "daily_check_ins",
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
  "review_chat_links",
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
  "personal_workflow_settings",
  "personal_workflow_runs",
  "assistant_settings",
  "assistant_conversations",
  "assistant_exchanges",
  "assistant_usage",
  "assistant_request_limits",
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
  "sheet_rest_project_links",
  "sheet_rest_datasets",
  "sheet_rest_rows",
  "sheet_rest_operations",
  "sheet_rest_runs",
  "sheet_rest_tests",
  "sheet_sync_sources",
  "sheet_sync_mappings",
  "sheet_sync_outbox",
  "managed_calendar_state",
  "canvas_documents",
  "canvas_document_chunks",
  "canvas_records",
  "canvas_sync_jobs",
  "canvas_mappings",
  "canvas_grade_history",
] as const;
export async function GET() {
  try {
    const { db, user } = await authorized();
    const records: Record<string, unknown[]> = {};
    for (const table of tables) {
      records[table] = [];
      let page = 0;
      while (true) {
        const documents = [
          "canvas_documents",
          "canvas_document_chunks",
        ].includes(table);
        const key =
          table === "sheet_rest_project_links"
            ? "row_id"
            : table === "daily_check_ins"
              ? "day"
              : table === "briefing_settings"
                ? "user_id"
                : table === "review_chat_links"
                  ? "review_id"
                  : documents
                    ? "course_canvas_id"
                    : table === "managed_calendar_state"
                      ? "block_id"
                      : ["canvas_records", "canvas_mappings"].includes(table)
                        ? "canvas_id"
                        : table === "assistant_usage"
                          ? "usage_day"
                          : table === "personal_workflow_settings"
                            ? "workflow_type"
                            : table === "canvas_sync_jobs"
                              ? "job_key"
                              : ["profiles", "assistant_settings"].includes(
                                    table,
                                  )
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
        if (documents) query = query.order("canvas_file_id");
        if (table === "canvas_document_chunks")
          query = query.order("chunk_index");
        if (["canvas_records", "canvas_mappings"].includes(table))
          query = query.order("resource_type");
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
