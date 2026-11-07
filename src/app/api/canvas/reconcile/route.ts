import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
import { canvasAdmin } from "@/lib/canvas/secure";
import { normalized } from "@/lib/canvas/resources";
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { user } = await authorized();
    const x = z
      .object({
        type: z.enum(["course", "assignment", "assignment_group"]),
        id: z.string().regex(/^[\d:]+$/),
        target: z.uuid(),
        confirmed: z.literal(true),
        source_hash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .parse(await readJson(request));
    const db = canvasAdmin();
    const r = await db
      .from("canvas_records")
      .select("payload")
      .eq("user_id", user.id)
      .eq("resource_type", x.type)
      .eq("canvas_id", x.id)
      .single();
    dbError(r.error);
    if (!r.data) throw new ApiError(404, "Canvas source record is missing.");
    if (
      createHash("sha256")
        .update(JSON.stringify(r.data.payload))
        .digest("hex") !== x.source_hash
    )
      throw new ApiError(
        409,
        "Canvas changed since this review. Reload the values before confirming.",
      );
    const result = await db.rpc("canvas_accept", {
      p_user: user.id,
      p_type: x.type,
      p_id: x.id,
      p_target: x.target,
      p_values: normalized(x.type, r.data.payload),
      p_source: r.data.payload,
    });
    dbError(result.error);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
export async function GET(request: Request) {
  try {
    const { user, db: owner } = await authorized();
    const q = new URL(request.url).searchParams;
    const x = z
      .object({
        type: z.enum(["course", "assignment", "assignment_group"]),
        id: z.string().regex(/^[\d:]+$/),
      })
      .parse({ type: q.get("type"), id: q.get("id") });
    const db = canvasAdmin();
    const r = await db
      .from("canvas_records")
      .select("payload")
      .eq("user_id", user.id)
      .eq("resource_type", x.type)
      .eq("canvas_id", x.id)
      .single();
    dbError(r.error);
    const m = await db
      .from("canvas_mappings")
      .select("local_id")
      .eq("user_id", user.id)
      .eq("resource_type", x.type)
      .eq("canvas_id", x.id)
      .single();
    dbError(m.error);
    const courses = await owner
      .from("courses")
      .select("id,code,title,term_id")
      .eq("user_id", user.id)
      .limit(500);
    dbError(courses.error);
    let local = null;
    if (x.type === "assignment_group" && m.data?.local_id) {
      const group = await owner
        .from("grading_categories")
        .select("name,weight")
        .eq("user_id", user.id)
        .eq("id", m.data.local_id)
        .single();
      dbError(group.error);
      local = group.data;
    }
    if (x.type === "assignment" && m.data?.local_id) {
      const a = await owner
        .from("assessments")
        .select(
          "title,earned_score,maximum_score,due_at,due_date,submission_state,notes,score_unit,verification_status",
        )
        .eq("user_id", user.id)
        .eq("id", m.data.local_id)
        .single();
      dbError(a.error);
      local = a.data;
    }
    return NextResponse.json(
      {
        incoming: normalized(x.type, r.data!.payload),
        source_hash: createHash("sha256")
          .update(JSON.stringify(r.data!.payload))
          .digest("hex"),
        target: m.data?.local_id,
        local,
        courses: courses.data,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
