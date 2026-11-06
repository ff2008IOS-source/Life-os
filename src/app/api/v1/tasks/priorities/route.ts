import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { items } = z
      .object({
        items: z
          .array(
            z
              .object({
                id: z.uuid(),
                version: z.number().int().positive(),
                position: z.number().int().min(0).max(1000),
              })
              .strict(),
          )
          .max(1000),
      })
      .strict()
      .parse(await readJson(request));
    const { db } = await authorized();
    const { error } = await db.rpc("reorder_priorities", { items });
    dbError(error);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
