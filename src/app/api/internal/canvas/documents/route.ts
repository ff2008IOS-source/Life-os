import { z } from "zod";
import { readJson } from "@/lib/http";
import { NextResponse } from "next/server";
import { validNotificationSignature } from "@/lib/notification-worker-auth";
import { canvasDocumentWorker } from "@/lib/canvas/documents-server";
import { failure } from "@/lib/http";
export const maxDuration = 120;
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
    const target = z
      .object({
        course: z.string().regex(/^\d+$/).optional(),
        file: z.string().regex(/^\d+$/).optional(),
      })
      .strict()
      .refine((x) => !x.file || !!x.course)
      .parse(await readJson(request));
    return NextResponse.json(
      await canvasDocumentWorker(target.course ?? null, target.file ?? null),
    );
  } catch (e) {
    return failure(e);
  }
}
