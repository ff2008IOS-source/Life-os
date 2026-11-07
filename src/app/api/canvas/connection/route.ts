import { NextResponse } from "next/server";
import { authorized, ApiError } from "@/lib/auth";
import { CanvasClient } from "@/lib/canvas/client";
import { canvasAdmin, encryptToken } from "@/lib/canvas/secure";

export const runtime = "nodejs";
export async function GET() {
  try {
    const { user } = await authorized();
    const { data, error } = await canvasAdmin().from("canvas_connections").select("expires_at,last_sync_at,last_error").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ connected: !!data, expires_at: data?.expires_at, last_sync_at: data?.last_sync_at, last_error: data?.last_error }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  try {
    const { user } = await authorized();
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    const input = body as Record<string, unknown>;
    const token = input.token;
    const expiresAt = input.expires_at;
    if (typeof token !== "string" || token.length < 12 || token.length > 4096) return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    if (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) return NextResponse.json({ error: "Enter the future Canvas token expiry date" }, { status: 400 });
    const courses = await new CanvasClient(token).courses();
    const encrypted = encryptToken(token);
    const { error } = await canvasAdmin().from("canvas_connections").upsert({ user_id: user.id, ...encrypted, expires_at: expiresAt, last_error: null, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw error;
    return NextResponse.json({ connected: true, course_count: courses.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return failure(e); }
}
function failure(e: unknown) {
  if (e instanceof ApiError) return NextResponse.json({ error: e.message }, { status: e.status });
  return NextResponse.json({ error: "Canvas connection failed. Check token, expiry and server configuration." }, { status: 500 });
}
