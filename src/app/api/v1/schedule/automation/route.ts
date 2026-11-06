import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { dbError, failure, checkMutation, readJson } from "@/lib/http";
import { DEFAULT_POLICY, policySchema } from "@/lib/scheduler";
import { serverAdmin } from "@/lib/supabase/admin";
export async function GET() {
  try {
    const { db, user } = await authorized();
    const setting = await db
      .from("scheduling_automation")
      .select("enabled,policy,last_checked_at,last_status,last_error")
      .eq("user_id", user.id)
      .maybeSingle();
    dbError(setting.error);
    return NextResponse.json(
      setting.data ?? {
        enabled: false,
        policy: DEFAULT_POLICY,
        last_status: null,
        last_error: null,
      },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { user, db } = await authorized();
    const input = z
      .object({
        enabled: z.boolean(),
        policy: policySchema.default(DEFAULT_POLICY),
      })
      .strict()
      .parse(await readJson(request));
    if (input.enabled) {
      const calendar = await db
        .from("calendars")
        .select("id")
        .eq("user_id", user.id)
        .eq("is_life_os_owned", true)
        .eq("write_enabled", true)
        .maybeSingle();
      dbError(calendar.error);
      if (!calendar.data)
        throw new ApiError(
          409,
          "Connect the separate Life OS calendar before enabling automation.",
        );
    }
    const admin = serverAdmin();
    const saved = await admin
      .from("scheduling_automation")
      .upsert(
        {
          user_id: user.id,
          enabled: input.enabled,
          policy: input.policy,
          last_error: null,
        },
        { onConflict: "user_id" },
      );
    dbError(saved.error);
    if (input.enabled) {
      const projects = await admin
        .from("projects")
        .update({ automation_enabled: true })
        .eq("user_id", user.id)
        .eq("status", "active")
        .not("source_id", "is", null);
      dbError(projects.error);
    }
    return NextResponse.json({ enabled: input.enabled });
  } catch (e) {
    return failure(e);
  }
}
