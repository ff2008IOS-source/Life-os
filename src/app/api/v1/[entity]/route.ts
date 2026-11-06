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
    const stamp =
      (entity === "tasks" || entity === "milestones") &&
      "status" in values &&
      values.status === "completed"
        ? { completed_at: new Date().toISOString() }
        : {};
    const { data, error } = await db
      .from(entity)
      .insert({ ...values, ...stamp, user_id: user.id })
      .select()
      .single();
    dbError(error);
    return NextResponse.json({ data }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
