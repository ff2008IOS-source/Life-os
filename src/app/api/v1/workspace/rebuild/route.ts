import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { db } = await authorized();
    const x = z
      .object({ dataset_id: z.uuid() })
      .strict()
      .parse(await readJson(request));
    const r = await db.rpc("rebuild_source_execution", {
      p_dataset: x.dataset_id,
    });
    dbError(r.error);
    return NextResponse.json(r.data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
