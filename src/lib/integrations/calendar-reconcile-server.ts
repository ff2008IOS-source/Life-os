import "server-only";
import { calendarBusy } from "../calendar-availability";
import { deadlineInstant, localDate } from "../dates";
import { randomUUID } from "node:crypto";
import { ApiError } from "../auth";
import { dbError } from "../http";
import { DEFAULT_POLICY, policySchema } from "../scheduler";
import {
  connectionAccessForUser,
  integrationAdmin,
  integrationRpc,
} from "./google-server";
import { googleEventSchema } from "./google-calendar";
import {
  managedEventReason,
  type ManagedBlock,
} from "./calendar-reconciliation";
export async function reconcileManagedCalendar(
  user: string,
  calendar: string,
  existingLease?: string,
) {
  const db = integrationAdmin();
  const c = await db
    .from("calendars")
    .select(
      "id,connection_id,provider_calendar_id,is_life_os_owned,write_enabled",
    )
    .eq("user_id", user)
    .eq("id", calendar)
    .single();
  dbError(c.error);
  if (!c.data?.is_life_os_owned || !c.data.write_enabled)
    return { checked: 0, conflicts: 0 };
  const records = await db
    .from("work_blocks")
    .select(
      "id,version,task_id,run_id,start_at,end_at,provider_event_id,provider_etag,calendar_event_id",
    )
    .eq("user_id", user)
    .eq("status", "planned")
    .not("provider_event_id", "is", null)
    .order("id")
    .limit(201);
  dbError(records.error);
  if (!records.data?.length) return { checked: 0, conflicts: 0 };
  if (records.data.length > 200)
    throw new ApiError(422, "Too many managed sessions to reconcile safely.");
  const cache = await db
    .from("calendar_events")
    .select("id,etag,event_status")
    .eq("user_id", user)
    .eq("calendar_id", calendar)
    .in(
      "id",
      records.data.map((b) => b.calendar_event_id),
    );
  dbError(cache.error);
  const changed = records.data.filter((b) => {
    const e = cache.data?.find((e) => e.id === b.calendar_event_id);
    return !e || e.event_status === "cancelled" || e.etag !== b.provider_etag;
  });
  if (!changed.length) return { checked: 0, conflicts: 0 };
  const lease = existingLease ?? randomUUID();
  if (
    !existingLease &&
    !(await integrationRpc<boolean>("claim_calendar_write", {
      p_user: user,
      p_token: lease,
    }))
  )
    throw new ApiError(
      409,
      "Calendar reconciliation is waiting for another reservation operation.",
    );
  try {
    const { token } = await connectionAccessForUser(user, c.data.connection_id);
    const setting = await db
      .from("scheduling_automation")
      .select("policy")
      .eq("user_id", user)
      .maybeSingle();
    dbError(setting.error);
    const policy = policySchema.parse({
      ...DEFAULT_POLICY,
      ...setting.data?.policy,
    });
    let checked = 0,
      conflicts = 0;
    for (const b of changed.slice(0, 8)) {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.data.provider_calendar_id)}/events/${encodeURIComponent(b.provider_event_id)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        },
      );
      let event;
      if (response.status === 404 || response.status === 410)
        event = { id: b.provider_event_id, status: "cancelled" as const };
      else {
        if (!response.ok)
          throw new ApiError(
            502,
            "Google could not confirm a changed work session. Existing reservations were preserved.",
          );
        event = googleEventSchema.parse(await response.json());
      }
      let reason = managedEventReason(b as ManagedBlock, event, policy);
      if (!reason && event.status !== "cancelled") {
        reason = await managedConstraintReason(
          user,
          b,
          event.start!.dateTime!,
          event.end!.dateTime!,
          policy,
          records.data,
        );
      }
      const state = await integrationRpc<string>("reconcile_managed_calendar", {
        p_user: user,
        p_block: b.id,
        p_version: b.version,
        p_lease: lease,
        p_event: event,
        p_reason: reason,
        p_accept: false,
      });
      if (state === "synced" && event.start?.dateTime && event.end?.dateTime) {
        b.start_at = event.start.dateTime;
        b.end_at = event.end.dateTime;
      }
      checked++;
      if (state !== "synced") conflicts++;
    }
    if (changed.length > 8)
      throw new ApiError(
        409,
        "More changed work sessions remain. Sync the dedicated calendar again before planning.",
      );
    return { checked, conflicts };
  } finally {
    if (!existingLease)
      await db
        .from("calendar_write_locks")
        .delete()
        .eq("user_id", user)
        .eq("lease_token", lease);
  }
}

export async function managedConstraintReason(
  user: string,
  b: ManagedBlock,
  s: string,
  end: string,
  policy: import("../scheduler").Policy,
  records: ManagedBlock[],
) {
  const db = integrationAdmin();
  let reason: string | null = null;

  const selected = await db
    .from("calendars")
    .select("id")
    .eq("user_id", user)
    .eq("sync_enabled", true);
  dbError(selected.error);
  const busy = await db
    .from("calendar_events")
    .select(
      "start_at,end_at,all_day_start,all_day_end,timezone,busy_status,event_status",
    )
    .eq("user_id", user)
    .in(
      "calendar_id",
      (selected.data ?? []).map((x) => x.id),
    )
    .neq("id", b.calendar_event_id)
    .eq("busy_status", "busy")
    .neq("event_status", "cancelled")
    .limit(10001);
  dbError(busy.error);
  if ((busy.data?.length ?? 0) > 10000)
    throw new ApiError(
      422,
      "Calendar availability exceeds the reconciliation limit.",
    );
  if (
    calendarBusy(busy.data ?? []).some(
      (x) =>
        Date.parse(x.start_at) <
          Date.parse(end) + policy.break_minutes * 60000 &&
        Date.parse(x.end_at) > Date.parse(s) - policy.break_minutes * 60000,
    )
  )
    reason =
      "The external move overlaps another commitment or its protected break.";
  const minutes = (Date.parse(end) - Date.parse(s)) / 60000;
  const daily = records
    .filter((x) => x.id !== b.id && localDate(x.start_at) === localDate(s))
    .reduce(
      (n, x) => n + (Date.parse(x.end_at) - Date.parse(x.start_at)) / 60000,
      0,
    );
  if (daily + minutes > policy.max_daily_minutes)
    reason = "The moved session exceeds your daily scheduled-work limit.";
  const task = await db
    .from("tasks")
    .select("due_at,due_date,status")
    .eq("user_id", user)
    .eq("id", b.task_id)
    .single();
  dbError(task.error);
  if (["completed", "cancelled"].includes(task.data!.status))
    reason = "The linked task is no longer active.";
  const deadline = deadlineInstant(task.data!);
  if (deadline && Date.parse(end) > deadline.getTime())
    reason = "The moved session ends after the task deadline.";
  const dependencies = await db
    .from("task_dependencies")
    .select("predecessor_task_id")
    .eq("user_id", user)
    .eq("successor_task_id", b.task_id)
    .limit(100);
  dbError(dependencies.error);
  if (dependencies.data?.length) {
    const predecessors = await db
      .from("tasks")
      .select("id,status")
      .eq("user_id", user)
      .in(
        "id",
        dependencies.data.map((x) => x.predecessor_task_id),
      );
    dbError(predecessors.error);
    if (predecessors.data?.some((x) => x.status !== "completed"))
      reason =
        "Review unfinished task dependencies before accepting the moved session.";
  }
  return reason;
}
