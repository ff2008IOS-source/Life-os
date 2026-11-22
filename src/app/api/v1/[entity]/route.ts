import { requireSundayReview } from "@/lib/review-access";
import { z } from "zod";
import { NextResponse } from "next/server";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
import { entitySchemas as schemas } from "@/lib/entity-schemas";
type Context = { params: Promise<{ entity: string }> };
function schemaFor(entity: string) {
  const schema = Object.hasOwn(schemas, entity)
    ? schemas[entity as keyof typeof schemas]
    : null;
  if (!schema) throw new ApiError(404, "Not found.");
  return schema;
}
export async function GET(request: Request, { params }: Context) {
  try {
    const { entity } = await params;
    schemaFor(entity);
    const { db, user } = await authorized();
    const url = new URL(request.url);
    const page = Math.max(
      0,
      Math.min(100000, Number(url.searchParams.get("page")) || 0),
    );
    const { data, error } = await db
      .from(entity)
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .order("id")
      .range(page * 50, page * 50 + 49);
    dbError(error);
    return NextResponse.json(
      { data, page, pageSize: 50 },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    checkMutation(request);
    const { entity } = await params;
    const schema = schemaFor(entity);
    const { db, user } = await authorized();
    const values = schema.parse(await readJson(request));
    if (entity === "reviews")
      await requireSundayReview(
        db,
        user.id,
        "period_start" in values ? String(values.period_start) : undefined,
        "period_end" in values ? String(values.period_end) : undefined,
      );
    const stamp =
      (entity === "tasks" || entity === "milestones") &&
      "status" in values &&
      values.status === "completed"
        ? { completed_at: new Date().toISOString() }
        : {};
    const operation = request.headers.get("Idempotency-Key");
    if (operation) z.uuid().parse(operation);
    const { data, error } = await db
      .from(entity)
      .insert({
        ...values,
        ...stamp,
        ...(operation ? { id: operation } : {}),
        user_id: user.id,
      })
      .select()
      .single();
    if (operation && error?.code === "23505") {
      const existing = await db
        .from(entity)
        .select("*")
        .eq("id", operation)
        .eq("user_id", user.id)
        .maybeSingle();
      dbError(existing.error);
      if (
        !existing.data ||
        Object.entries(values).some(
          ([key, value]) =>
            JSON.stringify(existing.data[key]) !== JSON.stringify(value),
        )
      )
        throw new ApiError(
          409,
          "This save identifier was already used. Reload the saved record before making another change.",
          "OPERATION_CONFLICT",
        );
      return NextResponse.json({ data: existing.data, replayed: true });
    }
    dbError(error);
    return NextResponse.json({ data }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
