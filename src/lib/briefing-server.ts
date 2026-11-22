import { reconcileAssessments } from "./assessment-identity";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { authorized, ApiError } from "./auth";
import { loadWorkspace } from "./services/workspace";
import {
  buildBriefing,
  briefingSettings,
  dayPlus,
  type Assessment,
  type BriefingAction,
} from "./briefing";
import { policySchema, DEFAULT_POLICY } from "./scheduler";
import { calendarDisplayEvents } from "./integrations/calendar-display-server";
import { canvasStatus } from "./canvas/service";
import type {
  CalendarEvent,
  CalendarRecord,
} from "./integrations/calendar-view";
import { dbError } from "./http";
/** Bounded owned queries; limit overflow is unavailable, never a partial total. */
export async function loadBriefingRows<T>(
  db: SupabaseClient,
  user: string,
  table: string,
  columns: string,
) {
  const result: T[] = [];
  for (let page = 0; page < 5; page++) {
    const r = await db
      .from(table)
      .select(columns)
      .eq("user_id", user)
      .order(table === "briefing_settings" ? "user_id" : "id")
      .range(page * 500, page * 500 + 499);
    dbError(r.error);
    result.push(...((r.data ?? []) as unknown as T[]));
    if (result.length > 2000)
      throw new ApiError(
        422,
        `${table} exceeds the briefing collection limit.`,
      );
    if ((r.data?.length ?? 0) < 500) return result;
  }
  throw new ApiError(422, `${table} exceeds the briefing collection limit.`);
}
export async function loadBriefing(
  week?: string,
  initialWorkspace?: Awaited<ReturnType<typeof loadWorkspace>>,
) {
  const { db, user } = await authorized();
  const decisionsPromise = db
    .from("integration_jobs")
    .select("id,job_type,payload,status,created_at")
    .eq("user_id", user.id)
    .in("job_type", ["work_replan_proposal", "missed_block_decision"])
    .in("status", ["pending", "running"])
    .order("created_at")
    .limit(21);
  const workspace = initialWorkspace ?? (await loadWorkspace());
  const errors: string[] = [];
  async function optional<T>(
    name: string,
    fn: () => Promise<T>,
    fallback: T,
  ): Promise<T> {
    try {
      return await fn();
    } catch {
      errors.push(name);
      return fallback;
    }
  }
  const [
    assessments,
    courses,
    calendars,
    connections,
    rawEvents,
    blocks,
    completions,
    sessions,
    topics,
    actions,
    settings,
    automation,
    canvas,
    sheetHealth,
  ] = await Promise.all([
    optional(
      "academics",
      () =>
        loadBriefingRows<Assessment>(
          db,
          user.id,
          "assessments",
          "id,title,course_id,task_id,due_at,due_date,submission_state,verification_status,earned_score,maximum_score,weight,dropped,source_key,source_status,score_unit",
        ),
      [],
    ),
    optional(
      "courses",
      () =>
        loadBriefingRows<{ id: string; code: string; title: string }>(
          db,
          user.id,
          "courses",
          "id,code,title",
        ),
      [],
    ),
    optional(
      "calendar",
      () =>
        loadBriefingRows<CalendarRecord>(
          db,
          user.id,
          "calendars",
          "id,connection_id,name,timezone,color,access_role,sync_enabled,last_synced_at,coverage_start,coverage_end,sync_error",
        ),
      [],
    ),
    optional(
      "calendar",
      () =>
        loadBriefingRows<{ id: string; status: string }>(
          db,
          user.id,
          "calendar_connections",
          "id,status",
        ),
      [],
    ),
    optional(
      "calendar",
      () =>
        loadBriefingRows<CalendarEvent>(
          db,
          user.id,
          "calendar_events",
          "id,calendar_id,provider_event_id,title,start_at,end_at,all_day_start,all_day_end,timezone,busy_status,event_status,raw_metadata",
        ).then((x) =>
          x.filter(
            (e) =>
              (e as CalendarEvent & { event_status: string }).event_status !==
              "cancelled",
          ),
        ),
      [],
    ),
    optional(
      "work",
      () =>
        loadBriefingRows<{
          id: string;
          task_id: string;
          start_at: string;
          end_at: string;
          status: string;
          actual_minutes: number | null;
        }>(
          db,
          user.id,
          "work_blocks",
          "id,task_id,start_at,end_at,status,actual_minutes",
        ),
      [],
    ),
    optional(
      "work",
      () =>
        loadBriefingRows<{
          task_id: string;
          actual_minutes: number;
          reported_at: string;
        }>(
          db,
          user.id,
          "work_completions",
          "task_id,actual_minutes,reported_at",
        ),
      [],
    ),
    optional(
      "study",
      () =>
        loadBriefingRows<{
          course_id: string;
          topic_id: string | null;
          actual_minutes: number | null;
          start_at: string | null;
          created_at: string;
        }>(
          db,
          user.id,
          "study_sessions",
          "course_id,topic_id,actual_minutes,start_at,created_at",
        ),
      [],
    ),
    optional(
      "study",
      () =>
        loadBriefingRows<{
          id: string;
          course_id: string;
          title: string;
          mastery: string;
        }>(db, user.id, "study_topics", "id,course_id,title,mastery"),
      [],
    ),
    loadBriefingRows<BriefingAction>(
      db,
      user.id,
      "briefing_actions",
      "id,kind,task_id,item_key,fingerprint,until_at,created_at",
    ),
    loadBriefingRows<{ settings: unknown; version: number }>(
      db,
      user.id,
      "briefing_settings",
      "settings,version",
    ),
    optional(
      "scheduling",
      () =>
        loadBriefingRows<{ policy: unknown }>(
          db,
          user.id,
          "scheduling_automation",
          "policy",
        ),
      [],
    ),
    optional("Canvas", () => canvasStatus(user.id), null),
    optional(
      "Sheets",
      async () => {
        const result = await db
          .from("sheet_rest_datasets")
          .select("id,title,mode,last_read_at,last_error")
          .eq("user_id", user.id)
          .eq("test_only", false)
          .limit(21);
        dbError(result.error);
        if ((result.data?.length ?? 0) > 20)
          throw new ApiError(422, "Source health exceeds the supported limit.");
        return result.data ?? [];
      },
      [],
    ),
  ]);
  const parsed = briefingSettings.safeParse(settings[0]?.settings ?? {});
  if (!parsed.success)
    throw new ApiError(
      422,
      "Briefing preferences are invalid. Reset them in Briefing settings.",
    );
  const events = await optional(
    "calendar",
    () => calendarDisplayEvents(db, user.id, rawEvents),
    [],
  );
  const facts = buildBriefing({
    workspace,
    sheet_health: sheetHealth,
    assessments: reconcileAssessments(assessments),
    courses,
    calendars,
    connections,
    events,
    blocks,
    completions,
    sessions,
    topics,
    actions,
    settings: parsed.data,
    source_errors: [...new Set(errors)],
    policy: policySchema.safeParse(automation[0]?.policy).success
      ? policySchema.parse(automation[0].policy)
      : DEFAULT_POLICY,
    canvas: canvas
      ? {
          connected: canvas.connected,
          ...canvas.connection,
          health: canvas.health,
        }
      : null,
    week,
  });
  const stable = {
    ...facts,
    refreshed_at: undefined,
    calendar: { ...facts.calendar, free_windows: undefined },
  };
  // Five-minute availability buckets invalidate narratives as the working day changes.
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(stable))
    .update(String(Math.floor(Date.now() / 300000)))
    .digest("hex");
  const decisionRows = await decisionsPromise;
  return {
    ...facts,
    planning_decisions: decisionRows.error
      ? undefined
      : decisionRows.data?.slice(0, 20),
    fingerprint,
    settings_version: settings[0]?.version ?? null,
    planning_timezone: "America/Vancouver",
    next_planning_week: dayPlus(facts.weekly.start, 7),
  };
}
export type LiveBriefing = Awaited<ReturnType<typeof loadBriefing>>;
