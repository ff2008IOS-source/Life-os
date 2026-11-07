import { NextResponse } from "next/server";
import { authorized } from "@/lib/auth";
import { dbError, failure } from "@/lib/http";
export async function GET() {
  try {
    const { db, user } = await authorized();
    const now = Date.now();
    const r = await db
      .from("canvas_deadlines")
      .select("canvas_id,title,due_at,synced_at,conflict,task_id,course_code")
      .eq("user_id", user.id)
      .gte("due_at", new Date(now - 7 * 86400000).toISOString())
      .lt("due_at", new Date(now + 14 * 86400000).toISOString())
      .order("due_at")
      .limit(31);
    dbError(r.error);
    return NextResponse.json(
      {
        records: r.data?.slice(0, 30) ?? [],
        has_more: (r.data?.length ?? 0) > 30,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
