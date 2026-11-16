import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
import { layoutSchema, migrateLayout } from "@/lib/dashboard-layout";
export async function GET() {
  try {
    const { db, user } = await authorized();
    const result = await db
      .from("dashboard_preferences")
      .select("settings,version")
      .eq("user_id", user.id)
      .maybeSingle();
    dbError(result.error);
    return NextResponse.json(
      {
        settings: migrateLayout(result.data?.settings),
        version: result.data?.version ?? 0,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function PUT(request: Request) {
  try {
    checkMutation(request);
    const { db, user } = await authorized();
    const input = z
      .object({ version: z.number().int().min(0), settings: layoutSchema })
      .strict()
      .parse(await readJson(request));
    const query =
      input.version === 0
        ? db
            .from("dashboard_preferences")
            .insert({ user_id: user.id, settings: input.settings })
        : db
            .from("dashboard_preferences")
            .update({ settings: input.settings })
            .eq("user_id", user.id)
            .eq("version", input.version);
    const result = await query.select("settings,version").maybeSingle();
    if (result.error?.code === "23505" || (!result.error && !result.data))
      throw new ApiError(
        409,
        "Your dashboard changed in another tab. Reload settings before saving.",
        "VERSION_CONFLICT",
      );
    dbError(result.error);
    return NextResponse.json(result.data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
