import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { CanvasClient, CanvasApiError } from "@/lib/canvas/client";
import { canvasAdmin, encryptToken } from "@/lib/canvas/secure";
import { canvasStatus, seedCanvas } from "@/lib/canvas/service";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
export const runtime = "nodejs";
export async function GET() {
  try {
    const { user } = await authorized();
    return NextResponse.json(await canvasStatus(user.id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { user } = await authorized();
    const db = canvasAdmin();
    const input = z
      .object({
        token: z
          .string()
          .trim()
          .min(12)
          .max(4096)
          .regex(/^[^\s]+$/),
        expires_at: z.iso.datetime({ offset: true }),
      })
      .strict()
      .parse(await readJson(request));
    if (
      Date.parse(input.expires_at) <= Date.now() ||
      Date.parse(input.expires_at) > Date.now() + 32 * 86400000
    )
      throw new ApiError(
        422,
        "Enter the token's actual expiry within the next 32 days.",
      );
    const limit = await db.rpc("canvas_token_attempt", { p_user: user.id });
    dbError(limit.error);
    if (!limit.data)
      throw new ApiError(429, "Wait 15 seconds before trying another token.");
    const identity = await new CanvasClient(input.token).identity();
    if (!identity.id)
      throw new ApiError(502, "Canvas did not confirm the token's account.");
    const account = z
      .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
      .transform(String)
      .parse(identity.id);
    const binding = await db.rpc("canvas_bind_identity", {
      p_user: user.id,
      p_canvas: account,
    });
    dbError(binding.error);
    if (!binding.data)
      throw new ApiError(
        422,
        "This token belongs to a different Canvas account. Existing academic records were preserved.",
      );
    const result = await db.from("canvas_connections").upsert(
      {
        user_id: user.id,
        ...encryptToken(input.token, user.id),
        expires_at: input.expires_at,
        generation: randomUUID(),
        enabled: true,
        last_error: null,
        lease_token: null,
        lease_until: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    dbError(result.error);
    await seedCanvas(user.id);
    const recovery = await db.rpc("canvas_resume_jobs", { p_user: user.id });
    dbError(recovery.error);
    return NextResponse.json(
      { connected: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(
      e instanceof CanvasApiError
        ? new ApiError(e.status === 401 ? 422 : 502, e.message)
        : e,
    );
  }
}
export async function PATCH(request: Request) {
  try {
    checkMutation(request);
    const { user } = await authorized();
    const input = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(await readJson(request));
    const result = await canvasAdmin()
      .from("canvas_connections")
      .update({ enabled: input.enabled })
      .eq("user_id", user.id);
    dbError(result.error);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(request: Request) {
  try {
    checkMutation(request);
    const { user } = await authorized();
    const result = await canvasAdmin()
      .from("canvas_connections")
      .delete()
      .eq("user_id", user.id);
    dbError(result.error);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
