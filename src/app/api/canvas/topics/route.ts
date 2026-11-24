import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
import { discoverTopics } from "@/lib/canvas/topic-discovery";
import { processCanvasDocuments } from "@/lib/canvas/documents-server";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { db, user } = await authorized();
    const x = z
      .discriminatedUnion("action", [
        z.object({
          action: z.literal("find"),
          course: z.uuid(),
          canvas: z.string().regex(/^\d+$/),
        }),
        z.object({
          action: z.enum(["add", "dismiss"]),
          course: z.uuid(),
          ids: z.array(z.uuid()).min(1).max(1000),
        }),
      ])
      .parse(await readJson(request));
    if (x.action === "find") {
      await processCanvasDocuments(user.id, x.canvas, null, 1);
      return NextResponse.json({
        message: await discoverTopics(user.id, x.course),
      });
    }
    const result = await db.rpc("review_topic_suggestions", {
      p_course: x.course,
      p_ids: x.ids,
      p_add: x.action === "add",
    });
    dbError(result.error);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
