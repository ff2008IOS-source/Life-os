import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized } from "@/lib/auth";
import { checkMutation, readJson, failure } from "@/lib/http";
import { syncCalendarForUser } from "@/lib/integrations/calendar-sync-service";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { user } = await authorized();
    const { calendar_id } = z
      .object({ calendar_id: z.uuid() })
      .strict()
      .parse(await readJson(request));
    return NextResponse.json(await syncCalendarForUser(user.id, calendar_id));
  } catch (error) {
    return failure(error);
  }
}
