import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { db } = await authorized();
    const x = z
      .object({
        assessment_id: z.uuid(),
        version: z.number().int().positive(),
        estimated_minutes: z.number().int().min(1).max(100000),
        eligible: z.boolean(),
      })
      .strict()
      .parse(await readJson(request));
    const result = await db.rpc("prepare_assessment", {
      p_assessment: x.assessment_id,
      p_version: x.version,
      p_minutes: x.estimated_minutes,
      p_eligible: x.eligible,
    });
    if (result.error?.code === "40001")
      throw new ApiError(
        409,
        "This assessment changed. Refresh and review its current deadline.",
      );
    if (result.error?.code === "P0002")
      throw new ApiError(404, "Assessment not found.");
    if (result.error?.code === "22023")
      throw new ApiError(
        422,
        "Check the effort estimate and submission state, and initialize your academic area first.",
      );
    dbError(result.error);
    return NextResponse.json({ task_id: result.data });
  } catch (e) {
    return failure(e);
  }
}
