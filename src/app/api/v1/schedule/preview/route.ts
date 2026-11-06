import { NextResponse } from "next/server";
import { z } from "zod";
import { checkMutation, readJson, failure } from "@/lib/http";
import { policySchema } from "@/lib/scheduler";
import { saveSchedulePreview } from "@/lib/services/scheduling";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { policy } = z
      .object({ policy: policySchema })
      .strict()
      .parse(await readJson(request));
    return NextResponse.json(await saveSchedulePreview(policy));
  } catch (error) {
    return failure(error);
  }
}
