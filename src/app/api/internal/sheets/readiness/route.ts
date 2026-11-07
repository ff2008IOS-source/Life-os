import { NextResponse } from "next/server";
import { validNotificationSignature } from "@/lib/notification-worker-auth";
import { sheetsReadinessWorker } from "@/lib/integrations/sheets-readiness-server";
import { failure } from "@/lib/http";
export const maxDuration = 60;
export async function POST(request: Request) {
  if (
    !validNotificationSignature(
      request.headers.get("x-lifeos-timestamp"),
      request.headers.get("x-lifeos-signature"),
      process.env.NOTIFICATION_WORKER_SECRET,
    )
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await sheetsReadinessWorker());
  } catch (e) {
    return failure(e);
  }
}
