import { processCanvasDocuments } from "@/lib/canvas/documents-server";
import { discoverTopics } from "@/lib/canvas/topic-discovery";
import { after, NextResponse } from "next/server";
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
    const synced = await syncCanvas(user.id, {
      manual,
      discover: new URL(request.url).searchParams.get("discover") === "true",
    });
    after(async () => {
      await processCanvasDocuments(user.id, null, null, 1);
      await discoverTopics(user.id);
    });
    return NextResponse.json(synced, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
