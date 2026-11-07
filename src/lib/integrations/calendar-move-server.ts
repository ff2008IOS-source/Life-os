import "server-only";
import { authorized, ApiError } from "../auth";
import { dbError } from "../http";
import { DEFAULT_POLICY, policySchema } from "../scheduler";
import { integrationAdmin, integrationRpc } from "./google-server";
import {
  withCalendarWriteLock,
  dedicatedCalendarForUser,
  googleWrite,
} from "./calendar-write-server";
import { syncCalendarForUser } from "./calendar-sync-service";
import {
  managedEventReason,
  type ManagedBlock,
} from "./calendar-reconciliation";
import { managedConstraintReason } from "./calendar-reconcile-server";
import {
  confirmConditionalMove,
  CalendarMoveConflict,
  type MoveIntent,
} from "./calendar-move";
export async function moveManagedSession(input: {
  request_id: string;
  block_id?: string;
  version?: number;
  start_at?: string;
  end_at?: string;
}) {
  const { user } = await authorized();
  return withCalendarWriteLock(user.id, async (lease) => {
    const db = integrationAdmin();
    const calendar = await dedicatedCalendarForUser(user.id);
    const previous = await db
      .from("integration_jobs")
      .select("id,status,payload")
      .eq("user_id", user.id)
      .eq("job_type", "calendar_reschedule")
      .eq("idempotency_key", input.request_id)
      .maybeSingle();
    dbError(previous.error);
    if (previous.data?.status === "completed")
      return { confirmed: true, replayed: true };
    let intent: MoveIntent, block: ManagedBlock & { status: string };
    if (previous.data) {
      const p = previous.data.payload as {
        intent: MoveIntent;
        block_id: string;
        version: number;
        calendar_id: string;
        provider_calendar_id: string;
      };
      if (previous.data.status !== "running")
        throw new ApiError(
          409,
          "This calendar move needs review. Sync its calendar before preparing another move.",
        );
      if (
        input.block_id &&
        (input.block_id !== p.block_id ||
          input.start_at !== p.intent.start_at ||
          input.end_at !== p.intent.end_at)
      )
        throw new ApiError(
          409,
          "This operation already represents a different move.",
        );
      if (
        p.calendar_id !== calendar.id ||
        p.provider_calendar_id !== calendar.provider_calendar_id
      )
        throw new ApiError(
          409,
          "The dedicated calendar changed. Review the pending operation before retrying.",
        );
      intent = p.intent;
      const b = await db
        .from("work_blocks")
        .select("*")
        .eq("user_id", user.id)
        .eq("id", p.block_id)
        .single();
      dbError(b.error);
      block = b.data as ManagedBlock & { status: string };
      if (
        block.status !== "planned" ||
        block.provider_event_id !== intent.event_id ||
        (block.version !== p.version &&
          (Date.parse(block.start_at) !== Date.parse(intent.start_at) ||
            Date.parse(block.end_at) !== Date.parse(intent.end_at)))
      )
        throw new ApiError(
          409,
          "Work-session history changed. This pending move needs review.",
        );
    } else {
      if (!input.block_id || !input.version || !input.start_at || !input.end_at)
        throw new ApiError(422, "Provide a session and its proposed time.");
      const pending = await db
        .from("integration_jobs")
        .select("id")
        .eq("user_id", user.id)
        .eq("job_type", "calendar_reschedule")
        .eq("status", "running")
        .limit(1);
      dbError(pending.error);
      if (pending.data?.length)
        throw new ApiError(
          409,
          "Confirm the pending calendar move before preparing another.",
        );
      const selected = await db
        .from("calendars")
        .select("id")
        .eq("user_id", user.id)
        .eq("sync_enabled", true)
        .limit(21);
      dbError(selected.error);
      if (!selected.data?.length || selected.data.length > 20)
        throw new ApiError(
          409,
          "Check your selected calendars before moving a work session.",
        );
      for (const c of selected.data)
        await syncCalendarForUser(user.id, c.id, lease);
      const b = await db
        .from("work_blocks")
        .select("*")
        .eq("user_id", user.id)
        .eq("id", input.block_id)
        .eq("status", "planned")
        .single();
      dbError(b.error);
      block = b.data as ManagedBlock & { status: string };
      if (block.version !== input.version)
        throw new ApiError(
          409,
          "This work session changed. Refresh before moving it.",
        );
      const ce = await db
        .from("calendar_events")
        .select("calendar_id")
        .eq("user_id", user.id)
        .eq("id", block.calendar_event_id)
        .single();
      dbError(ce.error);
      if (ce.data?.calendar_id !== calendar.id)
        throw new ApiError(
          403,
          "Only dedicated Life OS work sessions can be moved.",
        );
      const setting = await db
        .from("scheduling_automation")
        .select("policy")
        .eq("user_id", user.id)
        .maybeSingle();
      dbError(setting.error);
      const policy = policySchema.parse({
        ...DEFAULT_POLICY,
        ...setting.data?.policy,
      });
      const proposed = {
        id: block.provider_event_id,
        etag: block.provider_etag,
        start: { dateTime: input.start_at },
        end: { dateTime: input.end_at },
        extendedProperties: {
          private: { lifeos_run: block.run_id, lifeos_task: block.task_id },
        },
      };
      let reason = managedEventReason(block, proposed, policy);
      const blocks = await db
        .from("work_blocks")
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "planned")
        .limit(201);
      dbError(blocks.error);
      if ((blocks.data?.length ?? 0) > 200)
        throw new ApiError(
          422,
          "Too many work sessions to validate this move.",
        );
      reason ??= await managedConstraintReason(
        user.id,
        block,
        input.start_at,
        input.end_at,
        policy,
        blocks.data as ManagedBlock[],
      );
      if (reason) throw new ApiError(409, reason);
      intent = {
        operation: input.request_id,
        event_id: block.provider_event_id,
        etag: block.provider_etag!,
        run: block.run_id,
        task: block.task_id,
        start_at: input.start_at,
        end_at: input.end_at,
      };
      const j = await db.from("integration_jobs").insert({
        user_id: user.id,
        connection_id: calendar.connection_id,
        job_type: "calendar_reschedule",
        idempotency_key: input.request_id,
        payload: {
          intent,
          block_id: block.id,
          version: block.version,
          calendar_id: calendar.id,
          provider_calendar_id: calendar.provider_calendar_id,
        },
        status: "running",
      });
      dbError(j.error);
    }
    try {
      const event = await confirmConditionalMove(intent, (method, body, etag) =>
        googleWrite(
          `/calendar/v3/calendars/${encodeURIComponent(calendar.provider_calendar_id)}/events/${intent.event_id}`,
          calendar.token,
          method,
          body,
          etag,
        ),
      );
      await integrationRpc("finish_managed_calendar_move", {
        p_user: user.id,
        p_operation: input.request_id,
        p_lease: lease,
        p_event: event,
      });
      return { confirmed: true, replayed: false };
    } catch (e) {
      if (e instanceof CalendarMoveConflict) {
        const failed = await db
          .from("integration_jobs")
          .update({ status: "failed", last_error: e.message })
          .eq("user_id", user.id)
          .eq("job_type", "calendar_reschedule")
          .eq("idempotency_key", input.request_id);
        dbError(failed.error);
        throw new ApiError(409, e.message);
      }
      throw new ApiError(
        503,
        "The move is saved and awaiting confirmation. Use Retry confirmation; do not create a second move.",
      );
    }
  });
}
