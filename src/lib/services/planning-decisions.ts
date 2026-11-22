import { calendarCoverage } from "@/lib/calendar-availability";
import "server-only";
import { createHash } from "node:crypto";
import { deadlineInstant, preparationDeadline } from "../dates";
import { ApiError } from "../auth";
import { dbError } from "../http";
import { serverAdmin } from "../supabase/admin";
import { loadPlanningWorkspaceForUser } from "./workspace";
import { policySchema } from "../scheduler";
import { calendarBusy, type AvailabilityEvent } from "../calendar-availability";
import { replacementFor, type ReplanBlock } from "../replanning";
import { moveManagedSession } from "../integrations/calendar-move-server";
import { undoReservations } from "../integrations/calendar-write-server";
import { z } from "zod";
const kinds = ["work_replan_proposal", "missed_block_decision"];
const payload = z
  .object({
    block_id: z.uuid(),
    version: z.number(),
    task_id: z.uuid(),
    title: z.string(),
    original_start: z.string(),
    original_end: z.string(),
    deadline: z.string().nullable(),
    reason: z.string(),
    replacement: z
      .object({ start_at: z.string(), end_at: z.string() })
      .passthrough()
      .nullable(),
  })
  .passthrough();
export async function planningContext(user: string) {
  const db = serverAdmin();
  const [
    workspace,
    blocks,
    calendars,
    events,
    settings,
    assessments,
    connections,
  ] = await Promise.all([
    loadPlanningWorkspaceForUser(user),
    db
      .from("work_blocks")
      .select("*")
      .eq("user_id", user)
      .in("status", ["planned", "completed"])
      .order("id")
      .limit(501),
    db
      .from("calendars")
      .select(
        "id,connection_id,last_synced_at,sync_error,sync_enabled,coverage_start,coverage_end",
      )
      .eq("user_id", user)
      .eq("sync_enabled", true)
      .limit(21),
    db
      .from("calendar_events")
      .select(
        "id,provider_event_id,calendar_id,start_at,end_at,all_day_start,all_day_end,timezone,busy_status,event_status",
      )
      .eq("user_id", user)
      .neq("event_status", "cancelled")
      .order("id")
      .limit(2001),
    db
      .from("scheduling_automation")
      .select("policy")
      .eq("user_id", user)
      .maybeSingle(),
    db
      .from("assessments")
      .select("task_id,due_at,due_date,submission_state,dropped")
      .eq("user_id", user)
      .not("task_id", "is", null)
      .limit(501),
    db
      .from("calendar_connections")
      .select("id,status")
      .eq("user_id", user)
      .limit(21),
  ]);
  for (const result of [
    blocks,
    calendars,
    events,
    settings,
    assessments,
    connections,
  ])
    dbError(result.error);
  if (
    (blocks.data?.length ?? 0) > 500 ||
    (events.data?.length ?? 0) > 2000 ||
    (assessments.data?.length ?? 0) > 500 ||
    (calendars.data?.length ?? 0) > 20
  )
    throw new ApiError(422, "Planning context is too large to verify safely.");
  const policy = policySchema.parse(settings.data?.policy ?? {});
  const selected = calendars.data ?? [];
  const selectedIds = new Set(selected.map((c) => c.id));
  const owned = new Set((blocks.data ?? []).map((b) => b.provider_event_id));
  const external = (events.data ?? []).filter(
    (e) => selectedIds.has(e.calendar_id) && !owned.has(e.provider_event_id),
  );
  const reliable = calendarCoverage({
    calendars: selected,
    connections: connections.data ?? [],
    start: Date.now(),
    end: Date.now() + policy.scheduling_horizon_days * 86400000,
    now: Date.now(),
  }).verified;
  const tasks = workspace.tasks.map((t) => {
    const assessment = assessments.data?.find((a) => a.task_id === t.id);
    return {
      ...t,
      area: workspace.areas.find((a) => a.id === t.area_id)?.slug ?? null,
      eligible: t.scheduling_mode === "eligible",
      ...(assessment
        ? {
            ...preparationDeadline(t, assessment),
            status:
              assessment.dropped ||
              ["submitted", "returned", "excused"].includes(
                assessment.submission_state,
              )
                ? "completed"
                : t.status,
          }
        : {}),
    };
  });
  return {
    db,
    workspace,
    tasks,
    blocks: (blocks.data ?? []) as ReplanBlock[],
    busy: calendarBusy(external as AvailabilityEvent[]),
    external,
    policy,
    reliable,
  };
}
/** Upsert only new source identities; completed/dismissed decisions are never reopened. */
export async function generatePlanningDecisions(user: string) {
  const probe = await serverAdmin()
    .from("work_blocks")
    .select("id")
    .eq("user_id", user)
    .eq("status", "planned")
    .limit(1);
  dbError(probe.error);
  if (!probe.data?.length) {
    const existing = await serverAdmin()
      .from("integration_jobs")
      .select("id")
      .eq("user_id", user)
      .in("job_type", kinds)
      .eq("status", "pending")
      .limit(1);
    dbError(existing.error);
    if (!existing.data?.length) return { generated: 0 };
  }
  const c = await planningContext(user);
  const now = new Date().toISOString();
  const activeLedger = await c.db
    .from("integration_jobs")
    .select("id,version,payload,status,job_type")
    .eq("user_id", user)
    .in("job_type", kinds)
    .in("status", ["pending", "running"])
    .limit(201);
  dbError(activeLedger.error);
  if ((activeLedger.data?.length ?? 0) > 200)
    throw new ApiError(
      422,
      "Too many unresolved block decisions. Review existing decisions first.",
    );
  const pending =
    activeLedger.data?.filter((row) => row.status === "pending") ?? [];
  const missingIds = pending
    .map((row) => row.payload.block_id)
    .filter((id: string) => !c.blocks.some((b) => b.id === id));
  const other = missingIds.length
    ? await c.db
        .from("work_blocks")
        .select("id,status,start_at,end_at")
        .eq("user_id", user)
        .in("id", missingIds)
    : { data: [], error: null };
  dbError(other.error);
  for (const row of pending) {
    const block =
      c.blocks.find((b) => b.id === row.payload.block_id) ??
      other.data?.find((b) => b.id === row.payload.block_id);
    if (!block) continue;
    const outcome =
      block.status === "completed"
        ? "completed_elsewhere"
        : block.status === "cancelled"
          ? "dropped_elsewhere"
          : block.start_at !== row.payload.original_start ||
              block.end_at !== row.payload.original_end
            ? "moved_elsewhere"
            : null;
    if (outcome) {
      const done = await c.db
        .from("integration_jobs")
        .update({
          status: "completed",
          payload: { ...row.payload, outcome, decided_at: now },
        })
        .eq("user_id", user)
        .eq("id", row.id)
        .eq("version", row.version)
        .eq("status", "pending");
      dbError(done.error);
    }
  }
  const candidates = c.blocks.filter((b) => b.status === "planned");
  if (candidates.length > 100)
    throw new ApiError(
      422,
      "More than 100 unfinished blocks need review. Use Planner to narrow the plan before checking changes.",
    );
  let generated = 0;
  for (const block of c.blocks
    .filter((b) => b.status === "planned")
    .slice(0, 100)) {
    const task = c.tasks.find((t) => t.id === block.task_id);
    if (!task) continue;
    const missed = Date.parse(block.end_at) < Date.now();
    const deadline = task.due_at ?? task.due_date;
    const due = deadlineInstant(task)?.getTime() ?? Infinity;
    const overlaps = c.external
      .flatMap((event) =>
        calendarBusy([event as AvailabilityEvent])
          .filter(
            (interval) =>
              Date.parse(interval.start_at) < Date.parse(block.end_at) &&
              Date.parse(interval.end_at) > Date.parse(block.start_at),
          )
          .map((interval) => ({
            id: event.id,
            start: interval.start_at,
            end: interval.end_at,
          })),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    const terminal = ["completed", "cancelled"].includes(task.status);
    if (
      !missed &&
      !overlaps.length &&
      Date.parse(block.end_at) <= due &&
      !terminal
    ) {
      for (const old of pending.filter(
        (row) =>
          row.job_type === "work_replan_proposal" &&
          row.payload.block_id === block.id,
      )) {
        const cleared = await c.db
          .from("integration_jobs")
          .update({
            status: "cancelled",
            payload: {
              ...old.payload,
              outcome: "conflict_resolved",
              decided_at: now,
            },
          })
          .eq("user_id", user)
          .eq("id", old.id)
          .eq("version", old.version)
          .eq("status", "pending");
        dbError(cleared.error);
      }
      continue;
    }
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          block: block.id,
          version: missed ? undefined : block.version,
          overlaps,
          deadline,
          terminal,
        }),
      )
      .digest("hex");
    const decision =
      c.reliable && !terminal && !!block.provider_event_id
        ? replacementFor({
            block,
            tasks: c.tasks,
            blocks: c.blocks,
            busy: c.busy,
            dependencies: c.workspace.dependencies,
            policy: c.policy,
            now,
            missed,
          })
        : {
            replacement: null,
            reason: terminal
              ? "The assessment or task is finished. Review this unfinished work block."
              : !block.provider_event_id
                ? "This local block needs a manual change in Planner; it has no managed calendar event."
                : "Refresh selected calendars to verify a replacement.",
          };
    const key = missed
      ? `missed:${block.id}:${block.start_at}:${block.end_at}`
      : "replan:" + block.id + ":" + fingerprint;
    const superseded = await c.db
      .from("integration_jobs")
      .update({ status: "cancelled" })
      .eq("user_id", user)
      .in("job_type", kinds)
      .eq("status", "pending")
      .contains("payload", { block_id: block.id })
      .neq("idempotency_key", key);
    dbError(superseded.error);
    const result = await c.db
      .from("integration_jobs")
      .upsert(
        {
          user_id: user,
          job_type: missed ? kinds[1] : kinds[0],
          idempotency_key: key,
          status: "pending",
          payload: {
            block_id: block.id,
            version: block.version,
            task_id: task.id,
            title: task.title,
            original_start: block.start_at,
            original_end: block.end_at,
            deadline,
            reason: decision.reason,
            replacement: decision.replacement,
            terminal,
            recurring:
              !!task.recurrence_rule_id ||
              !!(block as ReplanBlock & { occurrence_id?: string })
                .occurrence_id,
          },
        },
        { onConflict: "user_id,idempotency_key", ignoreDuplicates: true },
      )
      .select("id");
    if (result.error?.code !== "23505") dbError(result.error);
    generated += result.data?.length ?? 0;
    if (!result.data?.length && decision.replacement) {
      const previous = await c.db
        .from("integration_jobs")
        .select("id,version,payload")
        .eq("user_id", user)
        .eq("idempotency_key", key)
        .eq("status", "pending")
        .maybeSingle();
      dbError(previous.error);
      if (
        previous.data &&
        (!previous.data.payload.replacement ||
          previous.data.payload.version !== block.version)
      ) {
        const updated = await c.db
          .from("integration_jobs")
          .update({
            payload: {
              ...previous.data.payload,
              version: block.version,
              reason: decision.reason,
              replacement: decision.replacement,
            },
          })
          .eq("user_id", user)
          .eq("id", previous.data.id)
          .eq("version", previous.data.version)
          .eq("status", "pending");
        dbError(updated.error);
      }
    }
  }
  return { generated };
}
export async function applyPlanningDecision(
  user: string,
  id: string,
  action: "accept" | "dismiss" | "still_planned" | "drop" | "completed",
  minutes?: number,
) {
  const db = serverAdmin();
  const found = await db
    .from("integration_jobs")
    .select("*")
    .eq("user_id", user)
    .eq("id", id)
    .in("job_type", kinds)
    .single();
  dbError(found.error);
  const job = found.data;
  if (!job) throw new ApiError(404, "Decision unavailable.");
  if (["completed", "cancelled"].includes(job.status))
    return { confirmed: true, replayed: true };
  const p = payload.parse(job.payload);
  const missed = job.job_type === kinds[1];
  if (!missed && ["still_planned", "completed"].includes(action))
    throw new ApiError(422, "This action applies to a missed occurrence only.");
  const previousMove = await db
    .from("integration_jobs")
    .select("status")
    .eq("user_id", user)
    .eq("job_type", "calendar_reschedule")
    .eq("idempotency_key", id)
    .maybeSingle();
  dbError(previousMove.error);
  if (
    job.status === "running" &&
    p.requested_action !== action &&
    !(action === "dismiss" && !previousMove.data)
  )
    throw new ApiError(
      409,
      "The earlier decision is still being confirmed. Retry that decision first.",
    );
  if (
    job.status === "running" &&
    action === "completed" &&
    p.requested_minutes !== minutes
  )
    throw new ApiError(
      409,
      "Retry with the original actual minutes to reconcile this outcome.",
    );
  let claimedThisRequest = job.status === "running";
  async function claim() {
    if (claimedThisRequest) return;
    const claimed = await db
      .from("integration_jobs")
      .update({
        status: "running",
        payload: {
          ...p,
          requested_action: action,
          requested_minutes: minutes ?? null,
        },
      })
      .eq("user_id", user)
      .eq("id", id)
      .eq("version", job.version)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    dbError(claimed.error);
    if (!claimed.data)
      throw new ApiError(
        409,
        "Another request is deciding this block. Refresh its status.",
      );
    claimedThisRequest = true;
  }
  if (action === "accept" && previousMove.data) {
    await claim();
    await moveManagedSession({ request_id: id, resolve_missed: missed });
  } else if (action === "accept") {
    if (!p.replacement)
      throw new ApiError(
        409,
        "There is no verified replacement. Refresh your plan.",
      );
    const context = await planningContext(user);
    if (!context.reliable)
      throw new ApiError(
        409,
        "Refresh selected calendars before accepting a move.",
      );
    const block = context.blocks.find((b) => b.id === p.block_id);
    if (!block || block.version !== p.version)
      throw new ApiError(
        409,
        "This block changed. Refresh and review the latest time.",
      );
    const task = context.tasks.find((t) => t.id === block.task_id);
    if (
      !task ||
      ["completed", "cancelled"].includes(task.status) ||
      Date.parse(p.replacement.end_at) >
        (deadlineInstant(task)?.getTime() ?? Infinity)
    )
      throw new ApiError(
        409,
        "The task or assessment changed. Refresh this proposal.",
      );
    if (
      context.workspace.dependencies.some(
        (d) =>
          d.successor_task_id === task.id &&
          !context.tasks.some(
            (t) => t.id === d.predecessor_task_id && t.status === "completed",
          ),
      )
    )
      throw new ApiError(409, "This task has an unfinished prerequisite.");
    await claim();
    await moveManagedSession({
      request_id: id,
      block_id: p.block_id,
      version: p.version,
      start_at: p.replacement.start_at,
      end_at: p.replacement.end_at,
      resolve_missed: missed,
    });
  } else if (action === "completed") {
    if (p.recurring)
      throw new ApiError(
        422,
        "Record this recurring occurrence from its task in Planner.",
      );
    if (!minutes) throw new ApiError(422, "Enter actual minutes worked.");
    await claim();
    // Reuse the existing owner-checked, versioned, idempotent completion transaction.
    const { authorized } = await import("../auth");
    const owner = await authorized();
    const result = await owner.db.rpc("complete_work_session", {
      p_block: p.block_id,
      p_version: p.version,
      p_request: id,
      p_minutes: minutes,
      p_start: null,
      p_end: null,
      p_finish: false,
      p_practiced: false,
      p_notes: "Recorded at daily check-in.",
    });
    dbError(result.error);
  } else if (action === "drop") {
    const b = await db
      .from("work_blocks")
      .select("*")
      .eq("user_id", user)
      .eq("id", p.block_id)
      .single();
    dbError(b.error);
    if (
      b.data?.status === "cancelled" &&
      job.status === "running" &&
      p.requested_action === "drop"
    ) {
      await claim();
    } else {
      if (!b.data || b.data.version !== p.version)
        throw new ApiError(
          409,
          "The block changed. Refresh before dropping it.",
        );
      await claim();
      if (missed || !b.data.provider_event_id) {
        const result = await db
          .from("work_blocks")
          .update({ status: "cancelled" })
          .eq("user_id", user)
          .eq("id", p.block_id)
          .eq("version", p.version)
          .select("id")
          .maybeSingle();
        dbError(result.error);
        if (!result.data) throw new ApiError(409, "The block changed.");
      } else {
        if (!b.data.run_id)
          throw new ApiError(
            409,
            "This calendar block needs review in Planner before removal.",
          );
        const result = await undoReservations(
          b.data.run_id,
          b.data.provider_event_id,
        );
        if (!result.removed)
          throw new ApiError(
            409,
            result.conflicts.join(" ") || "Removal could not be confirmed.",
          );
      }
    }
  }
  await claim();
  const done = await db
    .from("integration_jobs")
    .update({
      status: action === "dismiss" ? "cancelled" : "completed",
      payload: {
        ...p,
        requested_action: action,
        requested_minutes: minutes ?? null,
        outcome: action,
        decided_at: new Date().toISOString(),
      },
    })
    .eq("user_id", user)
    .eq("id", id);
  dbError(done.error);
  return { confirmed: true };
}
