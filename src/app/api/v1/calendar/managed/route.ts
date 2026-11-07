import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
import {
  integrationAdmin,
  integrationRpc,
  connectionAccessForUser,
} from "@/lib/integrations/google-server";
import { googleEventSchema } from "@/lib/integrations/google-calendar";
export async function GET() {
  try {
    const { db, user } = await authorized();
    const rows = await db
      .from("managed_calendar_state")
      .select(
        "block_id,task_id,state,planning_hold,reason,checked_at,last_provider_etag",
      )
      .eq("user_id", user.id)
      .eq("planning_hold", true)
      .order("checked_at", { ascending: false })
      .limit(100);
    dbError(rows.error);
    const pending = await db
      .from("integration_jobs")
      .select("idempotency_key,payload")
      .eq("user_id", user.id)
      .eq("job_type", "calendar_reschedule")
      .eq("status", "running")
      .limit(20);
    dbError(pending.error);
    return NextResponse.json(
      { records: rows.data, pending: pending.data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  let lease: string | undefined, userId: string | undefined;
  try {
    checkMutation(request);
    const { user } = await authorized();
    userId = user.id;
    const x = z
      .object({
        block_id: z.uuid(),
        checked_at: z.iso.datetime({ offset: true }),
        action: z.enum(["resume_planning", "accept_google"]),
        etag: z.string().nullable(),
        confirmed: z.literal(true),
      })
      .strict()
      .parse(await readJson(request));
    const db = integrationAdmin();
    const row = await db
      .from("managed_calendar_state")
      .select("*")
      .eq("user_id", user.id)
      .eq("block_id", x.block_id)
      .single();
    dbError(row.error);
    if (
      !row.data ||
      row.data.checked_at !== x.checked_at ||
      !row.data.planning_hold
    )
      throw new ApiError(
        409,
        "Calendar review changed. Refresh before confirming.",
      );
    lease = randomUUID();
    if (
      !(await integrationRpc<boolean>("claim_calendar_write", {
        p_user: user.id,
        p_token: lease,
      }))
    )
      throw new ApiError(409, "Another calendar operation is running.");
    if (x.action === "resume_planning") {
      if (row.data.state !== "externally_cancelled")
        throw new ApiError(
          409,
          "Review the external move before resuming this task.",
        );
      const r = await db
        .from("managed_calendar_state")
        .update({
          planning_hold: false,
          reason: "Owner resumed planning after external cancellation.",
        })
        .eq("user_id", user.id)
        .eq("block_id", x.block_id)
        .eq("checked_at", x.checked_at)
        .select("block_id");
      dbError(r.error);
      if (!r.data?.length) throw new ApiError(409, "Calendar review changed.");
    } else {
      const block = await db
        .from("work_blocks")
        .select("id,version,calendar_event_id,provider_event_id")
        .eq("user_id", user.id)
        .eq("id", x.block_id)
        .eq("status", "planned")
        .single();
      dbError(block.error);
      const cached = await db
        .from("calendar_events")
        .select("calendar_id")
        .eq("user_id", user.id)
        .eq("id", block.data!.calendar_event_id)
        .single();
      dbError(cached.error);
      const calendar = await db
        .from("calendars")
        .select("connection_id,provider_calendar_id")
        .eq("user_id", user.id)
        .eq("id", cached.data!.calendar_id)
        .eq("is_life_os_owned", true)
        .eq("write_enabled", true)
        .single();
      dbError(calendar.error);
      const { token } = await connectionAccessForUser(
        user.id,
        calendar.data!.connection_id,
      );
      const r = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.data!.provider_calendar_id)}/events/${encodeURIComponent(block.data!.provider_event_id)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!r.ok)
        throw new ApiError(
          409,
          "Google could not confirm this event. Sync its calendar and review again.",
        );
      const event = googleEventSchema.parse(await r.json());
      if (!x.etag || event.etag !== x.etag)
        throw new ApiError(
          409,
          "Google changed since this review. Sync its calendar and review again.",
        );
      await integrationRpc("reconcile_managed_calendar", {
        p_user: user.id,
        p_block: x.block_id,
        p_version: block.data!.version,
        p_lease: lease,
        p_event: event,
        p_reason: null,
        p_accept: true,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  } finally {
    if (lease && userId)
      await integrationAdmin()
        .from("calendar_write_locks")
        .delete()
        .eq("user_id", userId)
        .eq("lease_token", lease);
  }
}
