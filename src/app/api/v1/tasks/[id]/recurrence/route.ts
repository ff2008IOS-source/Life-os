import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
import { recurrenceInput, occurrenceDates } from "@/lib/recurrence";
import { localDate } from "@/lib/dates";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    checkMutation(request);
    const { id } = await params;
    z.uuid().parse(id);
    const values = recurrenceInput.parse(await readJson(request));
    const { db } = await authorized();
    let dates: string[];
    try {
      dates = occurrenceDates(
        values.rrule,
        values.start_date,
        values.end_date,
        localDate(),
      );
    } catch (e) {
      throw new ApiError(
        422,
        e instanceof Error ? e.message : "Invalid recurrence rule",
      );
    }
    const { error } = await db.rpc("configure_recurrence", {
      task_id_input: id,
      expected_version: values.version,
      rule_input: values.rrule,
      start_input: values.start_date,
      end_input: values.end_date,
      occurrence_dates: dates,
      today_input: localDate(),
    });
    dbError(error);
    return NextResponse.json({ generated: dates.length, horizon_days: 90 });
  } catch (e) {
    return failure(e);
  }
}
