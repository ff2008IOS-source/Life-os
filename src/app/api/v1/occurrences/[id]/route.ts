import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    checkMutation(request);
    const { id } = await params;
    z.uuid().parse(id);
    const { version, status } = z
      .object({
        version: z.number().int().positive(),
        status: z.enum(["planned", "completed", "cancelled"]),
      })
      .strict()
      .parse(await readJson(request));
    const { db, user } = await authorized();
    const { data: existing, error: readError } = await db
      .from("task_occurrences")
      .select("*")
      .eq("user_id", user.id)
      .eq("id", id)
      .eq("version", version)
      .maybeSingle();
    dbError(readError);
    if (!existing)
      throw new ApiError(409, "Occurrence changed. Refresh first.");
    const { data, error } = await db
      .from("task_occurrences")
      .update({
        status,
        completed_at:
          status === "completed"
            ? (existing.completed_at ?? new Date().toISOString())
            : null,
      })
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("version", version)
      .select()
      .maybeSingle();
    dbError(error);
    if (!data) throw new ApiError(409, "Occurrence changed. Refresh first.");
    return NextResponse.json({ data });
  } catch (e) {
    return failure(e);
  }
}
