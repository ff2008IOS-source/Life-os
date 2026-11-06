import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
import { serverAdmin } from "@/lib/supabase/admin";
import { verifyCurrentPassword } from "@/lib/password-security";
export async function GET() {
  try {
    const { db, user } = await authorized();
    const { data, error } = await db
      .from("deletion_requests")
      .select("id,requested_at,execute_after,last_error,claimed_at")
      .eq("user_id", user.id)
      .eq("status", "requested")
      .maybeSingle();
    dbError(error);
    return NextResponse.json({ pending: data });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { db, user } = await authorized();
    const input = z
      .discriminatedUnion("action", [
        z
          .object({
            action: z.literal("request"),
            password: z.string().min(1).max(200),
            confirmation: z.literal("DELETE"),
          })
          .strict(),
        z.object({ action: z.literal("cancel") }).strict(),
      ])
      .parse(await readJson(request));
    const admin = serverAdmin();
    if (input.action === "cancel") {
      const { data, error } = await admin
        .from("deletion_requests")
        .update({ status: "cancelled", last_error: null })
        .eq("user_id", user.id)
        .eq("status", "requested")
        .is("claimed_at", null)
        .select("id");
      dbError(error);
      if (!data?.length)
        throw new ApiError(
          409,
          "Deletion is already being finalized, or no pending request remains.",
        );
      return NextResponse.json({ cancelled: true });
    }
    await verifyCurrentPassword(user.id, user.email!, input.password);
    const executeAfter = new Date(Date.now() + 7 * 86400000).toISOString();
    const { data, error } = await admin
      .from("deletion_requests")
      .insert({ user_id: user.id, execute_after: executeAfter })
      .select("id,execute_after")
      .single();
    dbError(error);
    await db.auth.signOut({ scope: "global" });
    return NextResponse.json({ scheduled: true, ...data });
  } catch (error) {
    return failure(error);
  }
}
