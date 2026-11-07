import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
import { canvasAdmin } from "@/lib/canvas/secure";
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { user } = await authorized();
    const x = z
      .object({ id: z.string().regex(/^[\d:]+$/) })
      .strict()
      .parse(await readJson(request));
    const r = await canvasAdmin().rpc("canvas_create_task", {
      p_user: user.id,
      p_id: x.id,
    });
    dbError(r.error);
    return NextResponse.json({ id: r.data });
  } catch (e) {
    return failure(e);
  }
}
