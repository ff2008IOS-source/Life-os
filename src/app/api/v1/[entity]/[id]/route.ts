import { requireSundayReview } from "@/lib/review-access";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
import { entitySchemas as schemas } from "@/lib/entity-schemas";
type Context = { params: Promise<{ entity: string; id: string }> };
export async function PATCH(request: Request, { params }: Context) {
  try {
    checkMutation(request);
    const { entity, id } = await params;
    z.uuid().parse(id);
    const schema = Object.hasOwn(schemas, entity)
      ? schemas[entity as keyof typeof schemas]
      : null;
    if (!schema) throw new ApiError(404, "Not found.");
    const { db, user } = await authorized();
    const body = z
      .object({ version: z.number().int().positive(), data: z.unknown() })
      .strict()
      .parse(await readJson(request));
    const values = schema.parse(body.data);
    if (entity === "reviews")
      await requireSundayReview(
        db,
        user.id,
        "period_start" in values ? String(values.period_start) : undefined,
        "period_end" in values ? String(values.period_end) : undefined,
      );
    const { data: current, error: readError } = await db
      .from(entity)
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("version", body.version)
      .maybeSingle();
    dbError(readError);
    if (!current)
      throw new ApiError(
        409,
        "This record changed. Refresh first.",
        "VERSION_CONFLICT",
      );
    if (entity === "reviews")
      await requireSundayReview(
        db,
        user.id,
        current.period_start,
        current.period_end,
      );
    if (entity === "projects" && (current.deleted_at || current.archived_at))
      throw new ApiError(409, "Restore this project before editing it.");
    if (
      entity === "tasks" &&
      current.recurrence_rule_id &&
      "status" in values &&
      values.status === "completed"
    )
      throw new ApiError(
        422,
        "Complete individual recurring occurrences instead of the template.",
      );
    const stamp =
      (entity === "tasks" || entity === "milestones") && "status" in values
        ? {
            completed_at:
              values.status === "completed"
                ? (current.completed_at ?? new Date().toISOString())
                : null,
          }
        : {};
    const { data, error } = await db
      .from(entity)
      .update({ ...values, ...stamp })
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("version", body.version)
      .select()
      .maybeSingle();
    dbError(error);
    if (!data)
      throw new ApiError(
        409,
        "This record changed or is no longer available. Refresh before trying again.",
        "VERSION_CONFLICT",
      );
    return NextResponse.json({ data });
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(request: Request, { params }: Context) {
  try {
    checkMutation(request);
    const { entity, id } = await params;
    z.uuid().parse(id);
    if (!["tasks", "projects"].includes(entity))
      throw new ApiError(
        405,
        "Recoverable deletion is available for tasks and projects.",
      );
    const { version } = z
      .object({ version: z.number().int().positive() })
      .parse(await readJson(request));
    const { db, user } = await authorized();
    const { data, error } = await db
      .from(entity)
      .update({
        deleted_at: new Date().toISOString(),
        ...(entity === "projects" ? { automation_enabled: false } : {}),
      })
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("version", version)
      .select()
      .maybeSingle();
    dbError(error);
    if (!data) throw new ApiError(409, "Record changed. Refresh first.");
    return NextResponse.json({ data });
  } catch (e) {
    return failure(e);
  }
}

export async function GET(_request: Request, { params }: Context) {
  try {
    const { entity, id } = await params;
    z.uuid().parse(id);
    if (!Object.hasOwn(schemas, entity)) throw new ApiError(404, "Not found.");
    const { db, user } = await authorized();
    const { data, error } = await db
      .from(entity)
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    dbError(error);
    if (!data) throw new ApiError(404, "Record not found.");
    return NextResponse.json(
      { data },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
