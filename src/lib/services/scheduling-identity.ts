import "server-only";
import { authorized, ApiError } from "../auth";
import { serverAdmin } from "../supabase/admin";
/** Optional user ID is for the authenticated internal worker, never public request input. */
export async function schedulingIdentity(workerUserId?: string) {
  if (!workerUserId) return authorized();
  const db = serverAdmin();
  const { data, error } = await db.auth.admin.getUserById(workerUserId);
  if (
    error ||
    !data.user ||
    data.user.email?.toLowerCase() !==
      process.env.LIFE_OS_ALLOWED_EMAIL?.toLowerCase()
  )
    throw new ApiError(403, "Automation account is not approved.");
  return { db, user: data.user };
}
