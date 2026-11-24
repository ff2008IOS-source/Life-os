import { workerOutcome } from "@/lib/worker-outcome";
import { restSheetsWorker } from "@/lib/integrations/sheet-rest-server";
import { sheetSyncWorker } from "@/lib/integrations/sheet-sync-server";
import { managedCalendarWorker } from "@/lib/integrations/calendar-sync-service";
import { canvasDocumentWorker } from "@/lib/canvas/documents-server";
import { personalWorkflowWorker } from "@/lib/personal-workflows-server";
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
    const names = [
      "notifications",
      "automation",
      "canvas",
      "personal_workflows",
      "canvas_documents",
      "managed_calendar",
      "sheets",
      "sheets_rest",
    ] as const;
    const managedRead = managedCalendarWorker();
    const canvasSync = canvasWorker();
    const results = await Promise.allSettled([
      notificationWorker(),
      managedRead.then(() => runSchedulingAutomation()),
      canvasSync,
      personalWorkflowWorker(),
      canvasSync.then(
        () => canvasDocumentWorker(),
        () => canvasDocumentWorker(),
      ),
      managedRead,
      sheetSyncWorker(),
      restSheetsWorker(),
    ]);
    const response = Object.fromEntries(
      results.map((r, i) => [
        names[i],
        r.status === "fulfilled"
          ? {
              status: workerOutcome(r.value),
              result: r.value,
            }
          : {
              status: "failed",
              error: `${names[i]} worker failed. Review its source status and latest successful run.`,
            },
      ]),
    );
    return NextResponse.json(response, {
      status: results.every((r) => r.status === "rejected") ? 500 : 200,
    });
  } catch (e) {
    return failure(e);
  }
}
