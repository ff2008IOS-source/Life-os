import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
import { loadBriefing } from "@/lib/briefing-server";
import { briefingSettings } from "@/lib/briefing";
const day = z.iso.date();
const checkIn = z
  .object({
    day,
    timezone: z.string().max(100),
    accomplishments: z.string().max(2000),
    obstacles: z.string().max(2000),
    unfinished_commitments: z.string().max(2000),
    follow_up: z.string().max(2000),
    task_id: z.uuid().nullable(),
    goal_id: z.uuid().nullable(),
    status: z.enum(["draft", "completed", "skipped"]),
  })
  .strict();
export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    if (p.has("day")) {
      const { db, user } = await authorized(),
        date = day.parse(p.get("day"));
      const r = await db
        .from("daily_check_ins")
        .select(
          "day,timezone,accomplishments,obstacles,unfinished_commitments,follow_up,task_id,goal_id,status,version",
        )
        .eq("user_id", user.id)
        .eq("day", date)
        .maybeSingle();
      dbError(r.error);
      return NextResponse.json(
        { check_in: r.data },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const week = p.has("week") ? day.parse(p.get("week")) : undefined;
    return NextResponse.json(await loadBriefing(week), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { db, user } = await authorized();
    const raw = await readJson(request);
    const input = z
      .discriminatedUnion("type", [
        z.object({
          type: z.literal("check_in"),
          data: checkIn,
          version: z.number().int().positive().nullable(),
        }),
        z.object({
          type: z.literal("settings"),
          data: briefingSettings,
          version: z.number().int().positive().nullable(),
        }),
        z.object({
          type: z.literal("action"),
          id: z.uuid(),
          kind: z.enum(["defer", "snooze", "dismiss"]),
          task_id: z.uuid().nullable(),
          item_key: z.string().min(1).max(300),
          fingerprint: z.string().max(4000),
          until_at: z.iso.datetime({ offset: true }).nullable(),
        }),
      ])
      .parse(raw);
    if (input.type === "action") {
      if (input.kind === "defer" && !input.task_id)
        throw new ApiError(422, "A deferred action requires a task.");
      if (input.task_id) {
        const t = await db
          .from("tasks")
          .select("id")
          .eq("user_id", user.id)
          .eq("id", input.task_id)
          .is("deleted_at", null)
          .maybeSingle();
        dbError(t.error);
        if (!t.data) throw new ApiError(404, "Task unavailable.");
      }
      if (
        input.until_at &&
        (Date.parse(input.until_at) <= Date.now() ||
          Date.parse(input.until_at) > Date.now() + 30 * 86400000)
      )
        throw new ApiError(422, "Choose a snooze within the next 30 days.");
      const { type, ...values } = input;
      void type;
      const r = await db
        .from("briefing_actions")
        .upsert(
          { ...values, user_id: user.id },
          { onConflict: "user_id,id", ignoreDuplicates: true },
        );
      dbError(r.error);
      const stored = await db
        .from("briefing_actions")
        .select("kind,task_id,item_key,fingerprint,until_at")
        .eq("user_id", user.id)
        .eq("id", input.id)
        .maybeSingle();
      dbError(stored.error);
      if (
        !stored.data ||
        stored.data.kind !== input.kind ||
        stored.data.task_id !== input.task_id ||
        stored.data.item_key !== input.item_key ||
        stored.data.fingerprint !== input.fingerprint ||
        (stored.data.until_at ? Date.parse(stored.data.until_at) : null) !==
          (input.until_at ? Date.parse(input.until_at) : null)
      )
        throw new ApiError(
          409,
          "This action identity was already used for a different change.",
        );
      return NextResponse.json({ ok: true });
    }
    const table =
      input.type === "check_in" ? "daily_check_ins" : "briefing_settings";
    const values =
      input.type === "check_in" ? input.data : { settings: input.data };
    let query =
      input.version === null
        ? db.from(table).insert({ ...values, user_id: user.id })
        : db
            .from(table)
            .update(values)
            .eq("user_id", user.id)
            .eq("version", input.version);
    if (input.version !== null && input.type === "check_in")
      query = query.eq("day", input.data.day);
    const r = await query.select().maybeSingle();
    dbError(r.error);
    if (!r.data)
      throw new ApiError(409, "This record changed. Reload before saving.");
    return NextResponse.json({ data: r.data });
  } catch (e) {
    return failure(e);
  }
}
