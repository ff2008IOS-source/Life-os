import "server-only";
import { supabase, isConfigured } from "@/lib/supabase/server";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "REQUEST_FAILED",
  ) {
    super(message);
  }
}
export async function authorized() {
  if (!isConfigured())
    throw new ApiError(
      503,
      "Supabase is not configured. Complete the private setup first.",
      "SETUP_REQUIRED",
    );
  const db = await supabase();
  // getUser contacts Auth: revoked sessions and changed account information are checked.
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user)
    throw new ApiError(401, "Sign in to continue.", "UNAUTHENTICATED");
  if (
    user.email?.toLowerCase() !==
    process.env.LIFE_OS_ALLOWED_EMAIL?.toLowerCase()
  )
    throw new ApiError(403, "This account is not approved.", "FORBIDDEN");
  const { data: approved, error: approvalError } =
    await db.rpc("is_approved_user");
  if (approvalError || approved !== true)
    throw new ApiError(
      403,
      "This account has not been provisioned for Life OS.",
      "FORBIDDEN",
    );
  return { db, user };
}
