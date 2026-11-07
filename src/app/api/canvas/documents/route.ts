import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized } from "@/lib/auth";
import { checkMutation, readJson, failure, dbError } from "@/lib/http";
import { processCanvasDocuments } from "@/lib/canvas/documents-server";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { user } = await authorized();
    const x = z
      .object({
        course: z.string().regex(/^\d+$/).nullable().default(null),
        file: z.string().regex(/^\d+$/).nullable().default(null),
      })
      .strict()
      .parse(await readJson(request));
    return NextResponse.json(
      await processCanvasDocuments(user.id, x.course, x.file),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function GET(request: Request) {
  try {
    const { db, user } = await authorized();
    const p = new URL(request.url).searchParams;
    const course = z.string().regex(/^\d+$/).nullable().parse(p.get("course"));
    let q = db
      .from("canvas_documents")
      .select(
        "course_canvas_id,canvas_file_id,title,state,pages,truncated,extracted_at,last_checked_at,last_error",
      )
      .eq("user_id", user.id)
      .order("title")
      .limit(101);
    if (course) q = q.eq("course_canvas_id", course);
    const r = await q;
    dbError(r.error);
    return NextResponse.json(
      {
        documents: r.data?.slice(0, 100),
        has_more: (r.data?.length ?? 0) > 100,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
