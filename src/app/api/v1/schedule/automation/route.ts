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
      .select("enabled,policy,version,last_checked_at,last_status,last_error")
      .eq("user_id", user.id)
      .maybeSingle();
    dbError(setting.error);
    return NextResponse.json(
      setting.data
        ? {
            ...setting.data,
            policy: policySchema.parse(setting.data.policy ?? {}),
          }
        : {
            enabled: false,
            version: 0,
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
        policy: policySchema.optional(),
        version: z.number().int().min(0).optional(),
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
    const current = await admin
      .from("scheduling_automation")
      .select("policy,version")
      .eq("user_id", user.id)
      .maybeSingle();
    dbError(current.error);
    if (
      input.version !== undefined &&
      input.version !== (current.data?.version ?? 0)
    )
      throw new ApiError(
        409,
        "Planning preferences changed elsewhere. Reload before saving.",
      );
    const values = {
      enabled: input.enabled,
      policy: input.policy ?? policySchema.parse(current.data?.policy ?? {}),
      last_error: null,
    };
    const saved = current.data
      ? await admin
          .from("scheduling_automation")
          .update(values)
          .eq("user_id", user.id)
          .eq("version", current.data.version)
          .select("enabled,policy,version,last_status,last_error")
          .maybeSingle()
      : await admin
          .from("scheduling_automation")
          .insert({ user_id: user.id, ...values })
          .select("enabled,policy,version,last_status,last_error")
          .single();
    if (saved.error?.code === "23505" || (!saved.error && !saved.data))
      throw new ApiError(
        409,
        "Planning preferences changed elsewhere. Reload before saving.",
      );
    dbError(saved.error);
    if (input.enabled) {
      const projects = await admin
        .from("projects")
        .update({ automation_enabled: true })
        .eq("user_id", user.id)
        .eq("status", "active")
        .is("deleted_at", null)
        .is("archived_at", null)
        .not("source_id", "is", null);
      dbError(projects.error);
    }
    return NextResponse.json(saved.data);
  } catch (e) {
    return failure(e);
  }
}

export async function PATCH(request: Request) {
  try {
    checkMutation(request);
    const { user } = await authorized();
    const input = z
      .object({ policy: policySchema, version: z.number().int().min(0) })
      .strict()
      .parse(await readJson(request));
    const admin = serverAdmin();
    const saved =
      input.version === 0
        ? await admin
            .from("scheduling_automation")
            .insert({ user_id: user.id, enabled: false, policy: input.policy })
            .select("enabled,policy,version,last_status,last_error")
            .single()
        : await admin
            .from("scheduling_automation")
            .update({ policy: input.policy })
            .eq("user_id", user.id)
            .eq("version", input.version)
            .select("enabled,policy,version,last_status,last_error")
            .maybeSingle();
    if (saved.error?.code === "23505" || (!saved.error && !saved.data))
      throw new ApiError(
        409,
        "Planning preferences changed elsewhere. Reload before saving.",
      );
    dbError(saved.error);
    return NextResponse.json(saved.data);
  } catch (e) {
    return failure(e);
  }
}
