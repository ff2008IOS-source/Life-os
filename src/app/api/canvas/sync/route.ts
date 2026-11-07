import { NextResponse } from "next/server";
import { authorized } from "@/lib/auth";
import { syncCanvas } from "@/lib/canvas/service";
import { checkMutation, failure } from "@/lib/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { user } = await authorized();
    const manual = new URL(request.url).searchParams.get("refresh") === "true";
    return NextResponse.json(await syncCanvas(user.id, { manual }), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
