import { canvasWorker } from "@/lib/canvas/service";
import { runSchedulingAutomation } from "@/lib/scheduling-automation";
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
    const notifications = await notificationWorker();
    const automation = await runSchedulingAutomation();
    const canvas = await canvasWorker().catch(() => ({
      error:
        "Canvas background refresh failed. Review Canvas connection status.",
    }));
    return NextResponse.json({ ...notifications, automation, canvas });
  } catch (e) {
    return failure(e);
  }
}
