import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
import {
  applyPlanningDecision,
  generatePlanningDecisions,
} from "@/lib/services/planning-decisions";
export const maxDuration = 300;
export async function GET(request: Request) {
  try {
    const { db, user } = await authorized();
    const params = new URL(request.url).searchParams;
    const history = params.get("history") === "true";
    const page = z.coerce
      .number()
      .int()
      .min(0)
      .max(1000)
      .parse(params.get("page") ?? 0);
    const result = await db
      .from("integration_jobs")
      .select("id,job_type,payload,status,created_at")
      .eq("user_id", user.id)
      .in("job_type", ["work_replan_proposal", "missed_block_decision"])
      .in(
        "status",
        history ? ["completed", "cancelled"] : ["pending", "running"],
      )
      .order("created_at", { ascending: !history })
      .range(page * 20, page * 20 + 20);
    dbError(result.error);
    return NextResponse.json(
      {
        decisions: result.data?.slice(0, 20),
        page,
        more: (result.data?.length ?? 0) > 20,
      },
      { headers: { "Cache-Control": "private,no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { user } = await authorized();
    const input = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("check") }).strict(),
        z
          .object({
            action: z.enum([
              "accept",
              "dismiss",
              "still_planned",
              "drop",
              "completed",
            ]),
            id: z.uuid(),
            minutes: z.number().int().min(1).max(1440).optional(),
          })
          .strict(),
      ])
      .parse(await readJson(request));
    return NextResponse.json(
      input.action === "check"
        ? await generatePlanningDecisions(user.id)
        : await applyPlanningDecision(
            user.id,
            input.id,
            input.action,
            input.minutes,
          ),
    );
  } catch (e) {
    return failure(e);
  }
}
