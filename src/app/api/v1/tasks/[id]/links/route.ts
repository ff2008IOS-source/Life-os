import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
type Context = { params: Promise<{ id: string }> };
async function change(request: Request, { params }: Context, remove: boolean) {
  try {
    checkMutation(request);
    const { id } = await params;
    z.uuid().parse(id);
    const { kind, id: linked } = z
      .object({ kind: z.enum(["goal", "dependency"]), id: z.uuid() })
      .strict()
      .parse(await readJson(request));
    const { db, user } = await authorized();
    const table = kind === "goal" ? "goal_tasks" : "task_dependencies";
    const values: Record<string, string> =
      kind === "goal"
        ? { user_id: user.id, task_id: id, goal_id: linked }
        : {
            user_id: user.id,
            successor_task_id: id,
            predecessor_task_id: linked,
          };
    const query = remove
      ? db.from(table).delete().match(values)
      : db.from(table).insert(values);
    const { error } = await query;
    dbError(error);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(r: Request, c: Context) {
  return change(r, c, false);
}
export async function DELETE(r: Request, c: Context) {
  return change(r, c, true);
}
