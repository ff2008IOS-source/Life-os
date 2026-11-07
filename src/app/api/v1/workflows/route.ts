import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
import { workflowSetting, workflowType } from "@/lib/personal-workflows";
export async function GET(request: Request) {
  try {
    const { user, db } = await authorized();
    const page = z.coerce
      .number()
      .int()
      .min(0)
      .max(1000)
      .parse(new URL(request.url).searchParams.get("page") ?? 0);
    const [settings, runs] = await Promise.all([
      db.from("personal_workflow_settings").select("*").eq("user_id", user.id),
      db
        .from("personal_workflow_runs")
        .select("id,workflow_type,generated_at,scheduled_for,snapshot")
        .eq("user_id", user.id)
        .order("generated_at", { ascending: false })
        .range(page * 4, page * 4 + 4),
    ]);
    dbError(settings.error);
    dbError(runs.error);
    return NextResponse.json(
      {
        settings: settings.data,
        runs: runs.data?.slice(0, 4),
        has_more: (runs.data?.length ?? 0) > 4,
        page,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { db } = await authorized();
    const x = z
      .object({ type: workflowType, request_id: z.uuid() })
      .strict()
      .parse(await readJson(request));
    const r = await db.rpc("prepare_my_workflow", {
      p_type: x.type,
      p_request: x.request_id,
    });
    dbError(r.error);
    return NextResponse.json({ id: r.data });
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(request: Request) {
  try {
    checkMutation(request);
    const { db, user } = await authorized();
    const x = workflowSetting.parse(await readJson(request));
    const r = await db
      .from("personal_workflow_settings")
      .upsert(
        { ...x, user_id: user.id, timezone: "America/Vancouver" },
        { onConflict: "user_id,workflow_type" },
      );
    dbError(r.error);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
