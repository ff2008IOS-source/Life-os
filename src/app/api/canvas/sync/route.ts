import { NextResponse } from "next/server";
import { authorized, ApiError } from "@/lib/auth";
import { CanvasClient } from "@/lib/canvas/client";
import { canvasAdmin, decryptToken } from "@/lib/canvas/secure";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST() {
  try {
    const { user } = await authorized();
    const admin = canvasAdmin();
    const { data: connection, error } = await admin.from("canvas_connections").select("token_ciphertext,token_iv,expires_at").eq("user_id", user.id).single();
    if (error || !connection) return NextResponse.json({ error: "Connect Canvas first" }, { status: 400 });
    if (connection.expires_at && Date.parse(connection.expires_at) <= Date.now()) return NextResponse.json({ error: "Canvas token expired; renew it" }, { status: 401 });
    const canvas = new CanvasClient(decryptToken(connection.token_ciphertext, connection.token_iv));
    const courses = await canvas.courses();
    const records: { user_id: string; resource_type: string; canvas_id: string; course_canvas_id: string | null; payload: unknown; synced_at: string }[] = [];
    const add = (type: string, id: string, payload: unknown, courseId: string | null = null) => records.push({ user_id: user.id, resource_type: type, canvas_id: id, course_canvas_id: courseId, payload, synced_at: new Date().toISOString() });
    for (const course of courses) {
      add("course", String(course.id), course);
      const id = String(course.id);
      const [assignments, modules, announcements] = await Promise.all([canvas.assignments(course.id), canvas.modules(course.id), canvas.announcements(course.id)]);
      for (const item of assignments) add("assignment", String(item.id), item, id);
      for (const [type, items] of [["module", modules], ["announcement", announcements]] as const) {
        for (const item of items) {
          const entry = item as { id?: number };
          if (entry.id != null) add(type, String(entry.id), item, id);
        }
      }
    }
    for (let i = 0; i < records.length; i += 100) {
      const { error: writeError } = await admin.from("canvas_records").upsert(records.slice(i, i + 100), { onConflict: "user_id,resource_type,canvas_id" });
      if (writeError) throw writeError;
    }
    await admin.from("canvas_connections").update({ last_sync_at: new Date().toISOString(), last_error: null }).eq("user_id", user.id);
    return NextResponse.json({ synced: records.length, courses: courses.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof ApiError ? e.message : "Canvas sync failed; previously imported data was preserved" }, { status: e instanceof ApiError ? e.status : 500 });
  }
}
