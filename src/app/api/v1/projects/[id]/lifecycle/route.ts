import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    checkMutation(request);
    const { id } = await params;
    z.uuid().parse(id);
    const input = z
      .object({
        action: z.enum(["archive", "restore"]),
        version: z.number().int().positive(),
      })
      .strict()
      .parse(await readJson(request));
    const { db, user } = await authorized();
    const { data, error } = await db
      .from("projects")
      .update({
        archived_at:
          input.action === "archive" ? new Date().toISOString() : null,
        ...(input.action === "restore" ? { deleted_at: null } : {}),
        automation_enabled: false,
      })
      .eq("user_id", user.id)
      .eq("id", id)
      .eq("version", input.version)
      .select()
      .maybeSingle();
    dbError(error);
    if (!data)
      throw new ApiError(409, "Project changed. Refresh before trying again.");
    return NextResponse.json({ data });
  } catch (e) {
    return failure(e);
  }
}
