import { NextResponse } from "next/server";
import { z } from "zod";
import { checkMutation, readJson, failure } from "@/lib/http";
import { loadWorkspace } from "@/lib/services/workspace";
import { schedule, policySchema } from "@/lib/scheduler";
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { policy, busy } = z
      .object({
        policy: policySchema,
        busy: z
          .array(
            z
              .object({
                start_at: z.iso.datetime({ offset: true }),
                end_at: z.iso.datetime({ offset: true }),
              })
              .strict()
              .refine((b) => new Date(b.end_at) > new Date(b.start_at), {
                message: "Invalid busy range",
              }),
          )
          .max(500)
          .default([]),
      })
      .strict()
      .parse(await readJson(request));
    const data = await loadWorkspace();
    return NextResponse.json(
      schedule({
        now: new Date().toISOString(),
        policy,
        busy,
        existing: [],
        dependencies: data.dependencies,
        tasks: data.tasks
          .filter((t) => !t.deleted_at)
          .map((t) => ({
            ...t,
            area: data.areas.find((a) => a.id === t.area_id)?.slug ?? null,
            eligible:
              t.scheduling_mode === "eligible" ||
              !!data.projects.find((p) => p.id === t.project_id)
                ?.automation_enabled,
          })),
      }),
    );
  } catch (e) {
    return failure(e);
  }
}
