import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authorized, ApiError } from "../auth";
import { dbError } from "../http";
import {
  connectionAccess,
  connectionAccessForUser,
  integrationAdmin,
  integrationRpc,
} from "./google-server";
import { CALENDAR_WRITE_SCOPE } from "./google-oauth";
import {
  reservationId,
  assertOwnedReservation,
  type Reservation,
} from "./calendar-reservation";
import { schedulingIdentity } from "../services/scheduling-identity";
import { liveSchedule } from "../services/scheduling";
import { policySchema, type ScheduleResult } from "../scheduler";
const providerSchema = z
  .object({ id: z.string().min(1), etag: z.string().min(1) })
  .passthrough();
async function googleWrite(
  path: string,
  token: string,
  method: "GET" | "POST" | "DELETE",
  body?: unknown,
  etag?: string,
) {
  if (
    !/^\/calendar\/v3\/calendars(?:\/[^/]+\/events(?:\/[a-z0-9]+)?)?$/.test(
      path,
    )
  )
    throw Error("Invalid write endpoint");
  return fetch(
    "https://www.googleapis.com" +
      path +
      (path.includes("/events") ? "?sendUpdates=none" : ""),
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(etag ? { "If-Match": etag } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    },
  );
}
async function lock<T>(userId: string, work: () => Promise<T>) {
  const token = randomUUID();
  if (
    !(await integrationRpc<boolean>("claim_calendar_write", {
      p_user: userId,
      p_token: token,
    }))
  )
    throw new ApiError(
      409,
      "Another reservation operation is running. Wait a few minutes before trying again.",
    );
  try {
    return await work();
  } finally {
    await integrationAdmin()
      .from("calendar_write_locks")
      .delete()
      .eq("user_id", userId)
      .eq("lease_token", token);
  }
}
export async function setupDedicatedCalendar(connectionId: string) {
  const { user } = await authorized();
  const access = await connectionAccess(connectionId);
  if (!access.scope.split(" ").includes(CALENDAR_WRITE_SCOPE))
    throw new ApiError(
      409,
      "Reconnect with permission to create the separate Life OS calendar.",
      "WRITE_PERMISSION_REQUIRED",
    );
  return lock(user.id, async () => {
    const db = integrationAdmin();
    const existing = await db
      .from("calendars")
      .select("id,name")
      .eq("user_id", user.id)
      .eq("is_life_os_owned", true)
      .maybeSingle();
    dbError(existing.error);
    if (existing.data) return existing.data;
    const previous = await db
      .from("integration_jobs")
      .select("id")
      .eq("user_id", user.id)
      .eq("idempotency_key", "dedicated-calendar-create")
      .maybeSingle();
    dbError(previous.error);
    if (previous.data)
      throw new ApiError(
        409,
        "A calendar creation attempt already exists. It needs reconciliation before another calendar can be created.",
      );
    const job = await db
      .from("integration_jobs")
      .insert({
        user_id: user.id,
        connection_id: connectionId,
        job_type: "dedicated_calendar_create",
        idempotency_key: "dedicated-calendar-create",
        status: "running",
      })
      .select("id")
      .single();
    dbError(job.error);
    // Calendar creation has no provider idempotency key. Never blindly retry an ambiguous request.
    const response = await googleWrite(
      "/calendar/v3/calendars",
      access.token,
      "POST",
      {
        summary: "Life OS",
        description: "Work sessions explicitly reserved in Life OS.",
        timeZone: "America/Vancouver",
      },
    );
    if (!response.ok)
      throw new ApiError(
        502,
        "The separate calendar could not be confirmed. No existing calendar was changed.",
      );
    const created = z
      .object({ id: z.string(), summary: z.string(), timeZone: z.string() })
      .parse(await response.json());
    await db
      .from("integration_jobs")
      .update({ payload: { provider_calendar_id: created.id } })
      .eq("id", job.data!.id)
      .eq("user_id", user.id);
    const record = await db
      .from("calendars")
      .insert({
        user_id: user.id,
        connection_id: connectionId,
        provider_calendar_id: created.id,
        name: created.summary,
        timezone: created.timeZone,
        access_role: "owner",
        is_life_os_owned: true,
        write_enabled: true,
        sync_enabled: true,
      })
      .select("id,name")
      .single();
    dbError(record.error);
    await db
      .from("integration_jobs")
      .update({ status: "completed" })
      .eq("id", job.data!.id)
      .eq("user_id", user.id);
    return record.data;
  });
}
async function dedicated(userId: string) {
  const c = await integrationAdmin()
    .from("calendars")
    .select("id,connection_id,provider_calendar_id")
    .eq("user_id", userId)
    .eq("is_life_os_owned", true)
    .eq("write_enabled", true)
    .single();
  dbError(c.error);
  if (!c.data)
    throw new ApiError(409, "Set up the dedicated Life OS calendar first.");
  const { token, scope } = await connectionAccessForUser(
    userId,
    c.data.connection_id,
  );
  if (!scope.split(" ").includes(CALENDAR_WRITE_SCOPE))
    throw new ApiError(
      409,
      "Reconnect Google with the separate-calendar permission.",
    );
  return { ...c.data, token };
}
export async function applyReservations(runId: string, workerUserId?: string) {
  const { user } = await schedulingIdentity(workerUserId);
  return lock(user.id, async () => {
    const db = integrationAdmin();
    const calendar = await dedicated(user.id);
    const read = await db
      .from("scheduling_runs")
      .select("*")
      .eq("id", runId)
      .eq("user_id", user.id)
      .single();
    dbError(read.error);
    const run = read.data;
    if (
      !run ||
      !["preview", "failed"].includes(run.status) ||
      Date.parse(run.expires_at) < Date.now()
    )
      throw new ApiError(
        409,
        "This preview has expired or was already applied. Generate a fresh preview.",
      );
    const proposal = run.proposal as ScheduleResult;
    const policy = policySchema.parse(proposal.policy);
    const current = await liveSchedule(policy, true, workerUserId);
    if (current.revision !== run.input_revision)
      throw new ApiError(
        409,
        "Tasks, selected calendars, or availability changed. Generate a new preview before reserving.",
      );
    if (proposal.blocks.length > 60)
      throw new ApiError(422, "Too many sessions in one reservation request.");
    const changed = await db
      .from("scheduling_runs")
      .update({ status: "applying" })
      .eq("user_id", user.id)
      .eq("id", runId)
      .eq("version", run.version)
      .select("id")
      .maybeSingle();
    dbError(changed.error);
    if (!changed.data) throw new ApiError(409, "Preview changed. Refresh.");
    let applied = 0;
    const started = Date.now();
    try {
      for (const b of proposal.blocks) {
        if (workerUserId) {
          const setting = await db
            .from("scheduling_automation")
            .select("enabled")
            .eq("user_id", user.id)
            .single();
          dbError(setting.error);
          if (!setting.data?.enabled)
            throw new ApiError(
              409,
              "Automation was turned off. Remaining sessions were not reserved.",
            );
        }
        if (Date.now() - started > 180000)
          throw new ApiError(
            409,
            "Reservation time limit reached. Review confirmed sessions and undo before planning again.",
          );
        if (Date.parse(b.start_at) < Date.now() + policy.freeze_minutes * 60000)
          throw new ApiError(
            409,
            "A proposed session entered the freeze window. Generate a fresh preview.",
          );
        const id = reservationId(runId, b.task_id, b.start_at);
        const task = await db
          .from("tasks")
          .select("title")
          .eq("user_id", user.id)
          .eq("id", b.task_id)
          .single();
        dbError(task.error);
        const job = await db
          .from("integration_jobs")
          .upsert(
            {
              user_id: user.id,
              connection_id: calendar.connection_id,
              job_type: "calendar_reservation",
              idempotency_key: `reserve:${id}`,
              payload: {
                run_id: runId,
                calendar_id: calendar.id,
                provider_event_id: id,
                task_id: b.task_id,
                start_at: b.start_at,
                end_at: b.end_at,
              },
              status: "running",
            },
            { onConflict: "user_id,idempotency_key", ignoreDuplicates: true },
          )
          .select("id");
        dbError(job.error);
        const path = `/calendar/v3/calendars/${encodeURIComponent(calendar.provider_calendar_id)}/events`;
        const response = await googleWrite(path, calendar.token, "POST", {
          id,
          summary: `Life OS · ${task.data!.title}`,
          start: { dateTime: b.start_at, timeZone: "America/Vancouver" },
          end: { dateTime: b.end_at, timeZone: "America/Vancouver" },
          transparency: "opaque",
          visibility: "private",
          reminders: { useDefault: false },
          extendedProperties: {
            private: { lifeos_run: runId, lifeos_task: b.task_id },
          },
        });
        let event: Reservation;
        if (response.status === 409) {
          const found = await googleWrite(
            `${path}/${id}`,
            calendar.token,
            "GET",
          );
          if (!found.ok) throw Error("Reservation reconciliation failed.");
          event = providerSchema.parse(await found.json()) as Reservation;
        } else {
          if (!response.ok)
            throw Error("Reservation was not confirmed by Google.");
          event = providerSchema.parse(await response.json()) as Reservation;
        }
        assertOwnedReservation(event, runId, b.task_id, b.start_at, b.end_at);
        const saved = await db.from("work_blocks").upsert(
          {
            user_id: user.id,
            task_id: b.task_id,
            run_id: runId,
            provider_event_id: id,
            provider_etag: event.etag,
            start_at: b.start_at,
            end_at: b.end_at,
            status: "planned",
            policy_version: 1,
            last_planned_at: new Date().toISOString(),
          },
          { onConflict: "user_id,provider_event_id", ignoreDuplicates: true },
        );
        dbError(saved.error);
        const completed = await db
          .from("integration_jobs")
          .update({ status: "completed", last_error: null })
          .eq("user_id", user.id)
          .eq("idempotency_key", `reserve:${id}`);
        dbError(completed.error);
        applied++;
      }
      const done = await db
        .from("scheduling_runs")
        .update({
          status: "completed",
          applied_count: applied,
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId)
        .eq("user_id", user.id);
      dbError(done.error);
      return { applied };
    } catch (error) {
      await db
        .from("scheduling_runs")
        .update({
          status: "failed",
          applied_count: applied,
          error_summary:
            "Reservation stopped. Confirmed sessions were retained; review or undo this run before generating another plan.",
        })
        .eq("id", runId)
        .eq("user_id", user.id);
      throw error;
    }
  });
}
export async function undoReservations(runId: string) {
  const { user } = await authorized();
  return lock(user.id, async () => {
    const db = integrationAdmin();
    const calendar = await dedicated(user.id);
    const jobs = await db
      .from("integration_jobs")
      .select("id,payload,status")
      .eq("user_id", user.id)
      .eq("job_type", "calendar_reservation")
      .contains("payload", { run_id: runId })
      .limit(61);
    dbError(jobs.error);
    let removed = 0;
    const conflicts: string[] = [];
    for (const job of jobs.data ?? []) {
      if (job.status === "cancelled") continue;
      const p = z
        .object({
          provider_event_id: z.string().regex(/^[a-z0-9]+$/),
          task_id: z.uuid(),
          start_at: z.string(),
          end_at: z.string(),
          calendar_id: z.uuid(),
        })
        .parse(job.payload);
      if (p.calendar_id !== calendar.id)
        throw new ApiError(
          409,
          "Reservation belongs to a different dedicated calendar.",
        );
      if (Date.parse(p.start_at) < Date.now() + 3600000) {
        conflicts.push(
          "A session is past or inside the one-hour freeze window.",
        );
        continue;
      }
      const local = await db
        .from("work_blocks")
        .select("provider_etag,status")
        .eq("user_id", user.id)
        .eq("provider_event_id", p.provider_event_id)
        .maybeSingle();
      dbError(local.error);
      if (local.data?.status === "completed") {
        conflicts.push(
          "Completed work is preserved. This reservation cannot be undone as unworked time.",
        );
        continue;
      }
      const path = `/calendar/v3/calendars/${encodeURIComponent(calendar.provider_calendar_id)}/events/${p.provider_event_id}`;
      const found = await googleWrite(path, calendar.token, "GET");
      if (![404, 410].includes(found.status)) {
        if (!found.ok)
          throw new ApiError(
            502,
            "Reservation could not be checked. Nothing was deleted for this session.",
          );
        const event = providerSchema.parse(await found.json()) as Reservation;
        if (event.status !== "cancelled") {
          try {
            assertOwnedReservation(
              event,
              runId,
              p.task_id,
              p.start_at,
              p.end_at,
            );
          } catch {
            conflicts.push(
              "A session changed in Google Calendar and was preserved.",
            );
            continue;
          }
          if (!local.data?.provider_etag) {
            conflicts.push(
              "An unconfirmed session was preserved. Review or remove it directly in the dedicated Google calendar, then retry Undo to reconcile.",
            );
            continue;
          }
          if (
            local.data?.provider_etag &&
            local.data.provider_etag !== event.etag
          ) {
            conflicts.push(
              "A session changed in Google Calendar and was preserved.",
            );
            continue;
          }
          const deleted = await googleWrite(
            path,
            calendar.token,
            "DELETE",
            undefined,
            event.etag,
          );
          if (deleted.status === 412) {
            conflicts.push("A session changed during undo and was preserved.");
            continue;
          }
          if (!deleted.ok && ![404, 410].includes(deleted.status))
            throw new ApiError(
              502,
              "Google did not confirm removal. Retry undo to reconcile.",
            );
        }
      }
      const update = await db
        .from("work_blocks")
        .update({ status: "cancelled" })
        .eq("user_id", user.id)
        .eq("provider_event_id", p.provider_event_id);
      dbError(update.error);
      const jobUpdate = await db
        .from("integration_jobs")
        .update({ status: "cancelled" })
        .eq("user_id", user.id)
        .eq("id", job.id);
      dbError(jobUpdate.error);
      removed++;
    }
    return { removed, conflicts };
  });
}
