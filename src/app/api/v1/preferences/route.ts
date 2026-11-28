import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, dbError, failure, readJson } from "@/lib/http";
import { PREFERENCE_KEYS } from "@/lib/preferences";

/**
 * Saves one display preference to the account. Each key is checked, so
 * only known, small values are stored.
 */
const input = z
  .object({ key: z.enum(PREFERENCE_KEYS), value: z.unknown() })
  .strict();

const shapes: Record<(typeof PREFERENCE_KEYS)[number], z.ZodType> = {
  calendar_view: z.enum(["day", "week", "month", "agenda"]),
  calendar_hidden: z.array(z.uuid()).max(100),
  calendar_kind: z.enum(["all", "commitments", "sessions", "deadlines"]),
  calendar_group: z.boolean(),
  technical_details: z.boolean(),
  sidebar_collapsed: z.boolean(),
  today_skips: z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      keys: z.array(z.string().max(300)).max(300),
    })
    .strict(),
};

export async function PATCH(request: Request) {
  try {
    checkMutation(request);
    const { db } = await authorized();
    const x = input.parse(await readJson(request));
    const value = shapes[x.key].parse(x.value);
    const r = await db.rpc("set_ui_preference", {
      p_key: x.key,
      p_value: value,
    });
    dbError(r.error);
    if (r.data === null) throw new ApiError(404, "Profile not found.");
    const next = r.data;
    return NextResponse.json({ ui_preferences: next });
  } catch (e) {
    return failure(e);
  }
}
