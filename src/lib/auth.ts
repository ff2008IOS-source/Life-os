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
export async function sessionIdentity() {
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
  const { data: registered, error: registrationError } = await db.rpc(
    "has_registered_session",
  );
  if (registrationError || registered !== true)
    throw new ApiError(
      401,
      "Your session is no longer authorized. Sign in again.",
      "SESSION_REVOKED",
    );
  return { db, user };
}
export async function authorized() {
  const { db, user } = await sessionIdentity();
  if (user.factors?.some((f) => f.status === "verified")) {
    const { data, error } = await db.auth.getClaims();
    // A session from a remembered device (14 days) counts as verified.
    const trusted =
      !error && data?.claims.aal !== "aal2"
        ? (await db.rpc("session_trusted")).data === true
        : false;
    if (error || (data?.claims.aal !== "aal2" && !trusted))
      throw new ApiError(
        401,
        "Enter your authenticator code to continue.",
        "MFA_REQUIRED",
      );
  }
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
