import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
export async function GET() {
  try {
    const { db } = await authorized();
    const r = await db.rpc("preview_personal_activity_reset");
    dbError(r.error);
    return NextResponse.json(r.data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { db } = await authorized();
    const x = z
      .object({
        request_id: z.uuid(),
        token: z.string().regex(/^[a-f0-9]{32}$/),
        confirmation: z.literal("CLEAR MY ACTIVITY"),
        rebuild_source_backed: z.boolean().default(true),
      })
      .strict()
      .parse(await readJson(request));
    const r = await db.rpc("reset_personal_activity", {
      p_request: x.request_id,
      p_expected: x.token,
      p_confirmation: x.confirmation,
      p_rebuild: x.rebuild_source_backed,
    });
    dbError(r.error);
    return NextResponse.json(r.data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
