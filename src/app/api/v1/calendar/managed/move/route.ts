import { NextResponse } from "next/server";
import { z } from "zod";
import { checkMutation, readJson, failure } from "@/lib/http";
import { moveManagedSession } from "@/lib/integrations/calendar-move-server";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const x = z
      .discriminatedUnion("action", [
        z
          .object({
            action: z.literal("move"),
            request_id: z.uuid(),
            block_id: z.uuid(),
            version: z.number().int().positive(),
            start_at: z.iso.datetime({ offset: true }),
            end_at: z.iso.datetime({ offset: true }),
            confirmed: z.literal(true),
          })
          .strict(),
        z
          .object({
            action: z.literal("retry"),
            request_id: z.uuid(),
            confirmed: z.literal(true),
          })
          .strict(),
      ])
      .parse(await readJson(request));
    return NextResponse.json(await moveManagedSession(x));
  } catch (e) {
    return failure(e);
  }
}
