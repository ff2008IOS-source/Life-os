import { validNotificationSignature } from "@/lib/notification-worker-auth";
import { NextResponse } from "next/server";
import { validCronSecret } from "@/lib/integrations/daily-sync";
import { notificationWorker } from "@/lib/notifications-server";
import { failure } from "@/lib/http";
export const maxDuration = 300;
export async function POST(request: Request) {
  if (
    !validNotificationSignature(
      request.headers.get("x-lifeos-timestamp"),
      request.headers.get("x-lifeos-signature"),
      process.env.NOTIFICATION_WORKER_SECRET,
    ) &&
    !validCronSecret(
      request.headers.get("authorization"),
      process.env.NOTIFICATION_WORKER_SECRET,
    )
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await notificationWorker());
  } catch (e) {
    return failure(e);
  }
}
