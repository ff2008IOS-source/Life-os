import "server-only";
import { createHash } from "node:crypto";
import { addDays, format } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { ApiError } from "@/lib/auth";
import { dbError } from "@/lib/http";
import { schedulingIdentity } from "./scheduling-identity";
import { loadWorkspace, loadWorkspaceForUser } from "./workspace";
import { calendarBusy, type AvailabilityEvent } from "../calendar-availability";
import { localDate, TIMEZONE } from "../dates";
import { schedule, type Policy, type ExistingBlock } from "../scheduler";
import { syncCalendarForUser } from "../integrations/calendar-sync-service";
import { serverAdmin } from "../supabase/admin";
export async function liveSchedule(
  policy: Policy,
  forceRefresh = false,
  workerUserId?: string,
) {
  const { db, user } = await schedulingIdentity(workerUserId);
  const selected = await db
    .from("calendars")
    .select(
      "id,connection_id,last_synced_at,coverage_start,coverage_end,sync_error",
    )
    .eq("user_id", user.id)
    .eq("sync_enabled", true)
    .order("id");
  dbError(selected.error);
  if (!selected.data?.length)
    throw new ApiError(
      409,
      "Connect and select your calendars before planning. Unknown availability is never assumed free.",
    );
  const today = new Date(localDate() + "T12:00:00Z");
  const lower = fromZonedTime(
    localDate() + "T00:00:00",
    TIMEZONE,
  ).toISOString();
  const upper = fromZonedTime(
    format(addDays(today, policy.scheduling_horizon_days), "yyyy-MM-dd") +
      "T00:00:00",
    TIMEZONE,
  ).toISOString();
  for (const c of selected.data) {
    if (
      forceRefresh ||
      !c.last_synced_at ||
      Date.now() - Date.parse(c.last_synced_at) > 300000 ||
      c.sync_error ||
      !c.coverage_start ||
      !c.coverage_end ||
      c.coverage_start > lower ||
      c.coverage_end < upper
    )
      await syncCalendarForUser(user.id, c.id);
  }
  const events: AvailabilityEvent[] = [];
  for (let page = 0; page < 20; page++) {
    const response = await db
      .from("calendar_events")
      .select(
        "id,start_at,end_at,all_day_start,all_day_end,timezone,busy_status,event_status",
      )
      .eq("user_id", user.id)
      .in(
        "calendar_id",
        selected.data.map((c) => c.id),
      )
      .neq("event_status", "cancelled")
      .order("id")
      .range(page * 500, page * 500 + 499);
    dbError(response.error);
    events.push(...(response.data ?? []));
    if (!response.data || response.data.length < 500) break;
    if (page === 19)
      throw new ApiError(
        422,
        "Calendar availability exceeds the planning limit; narrow your selected calendars.",
      );
  }
  const pending = await db
    .from("integration_jobs")
    .select("id")
    .eq("user_id", user.id)
    .eq("job_type", "calendar_reservation")
    .eq("status", "running")
    .limit(1);
  dbError(pending.error);
  if (pending.data?.length)
    throw new ApiError(
      409,
      "A reservation needs reconciliation. Use Undo for its recent run before creating another plan.",
    );
  const existing: ExistingBlock[] = [];
  for (let page = 0; page < 20; page++) {
    const rows = await db
      .from("work_blocks")
      .select("id,version,task_id,start_at,end_at,status,actual_minutes")
      .eq("user_id", user.id)
      .in("status", ["planned", "completed"])
      .order("id")
      .range(page * 500, page * 500 + 499);
    dbError(rows.error);
    existing.push(...((rows.data ?? []) as ExistingBlock[]));
    if (!rows.data || rows.data.length < 500) break;
    if (page === 19)
      throw new ApiError(422, "Work-block planning limit exceeded.");
  }
  const active = await db
    .from("calendar_connections")
    .select("id,status")
    .eq("user_id", user.id)
    .in("id", [...new Set(selected.data.map((c) => c.connection_id))]);
  dbError(active.error);
  if (
    active.data?.some((c) => c.status !== "connected") ||
    active.data?.length !==
      new Set(selected.data.map((c) => c.connection_id)).size
  )
    throw new ApiError(409, "Reconnect Google before planning.");
  const workspace = workerUserId
    ? await loadWorkspaceForUser(workerUserId)
    : await loadWorkspace();
  const result = schedule({
    now: new Date().toISOString(),
    policy,
    busy: calendarBusy(events),
    existing: existing,
    dependencies: workspace.dependencies,
    tasks: workspace.tasks
      .filter(
        (t) =>
          !t.deleted_at && (!workerUserId || !t.title.startsWith("[TEST]")),
      )
      .map((t) => ({
        ...t,
        area: workspace.areas.find((a) => a.id === t.area_id)?.slug ?? null,
        eligible:
          t.scheduling_mode === "eligible" ||
          !!workspace.projects.find(
            (p) => p.id === t.project_id && p.status === "active",
          )?.automation_enabled,
      })),
  });
  const revision = createHash("sha256")
    .update(
      JSON.stringify({
        tasks: workspace.tasks,
        projects: workspace.projects,
        dependencies: workspace.dependencies,
        calendars: selected.data.map((c) => c.id),
        events,
        blocks: existing,
        policy,
      }),
    )
    .digest("hex");
  return {
    user,
    result: {
      ...result,
      availability_source: "google_calendar" as const,
      calendar_count: selected.data.length,
    },
    revision,
  };
}
export async function saveSchedulePreview(
  policy: Policy,
  workerUserId?: string,
) {
  const { user, result, revision } = await liveSchedule(
    policy,
    false,
    workerUserId,
  );
  const run = await serverAdmin()
    .from("scheduling_runs")
    .insert({
      user_id: user.id,
      status: "preview",
      input_revision: revision,
      proposed_count: result.blocks.length,
      proposal: result,
      expires_at: new Date(Date.now() + 600000).toISOString(),
    })
    .select("id,expires_at")
    .single();
  dbError(run.error);
  return { ...result, run_id: run.data!.id, expires_at: run.data!.expires_at };
}
