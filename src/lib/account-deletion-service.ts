import "server-only";
import { serverAdmin } from "./supabase/admin";
import { dbError } from "./http";
import { revokeGoogleForUser } from "./integrations/google-server";
/** Called only by the authenticated daily worker. No request is created by this job. */
export async function processAccountDeletions() {
  const db = serverAdmin();
  const { data: requests, error } = await db
    .from("deletion_requests")
    .select("id,user_id,version,claimed_at")
    .eq("status", "requested")
    .lte("execute_after", new Date().toISOString())
    .or(
      `claimed_at.is.null,claimed_at.lt.${new Date(Date.now() - 3600000).toISOString()}`,
    )
    .limit(10);
  dbError(error);
  const summary = { deleted: 0, failed: 0 };
  for (const request of requests ?? [])
    try {
      const claimed = await db
        .from("deletion_requests")
        .update({ claimed_at: new Date().toISOString() })
        .eq("id", request.id)
        .eq("version", request.version)
        .eq("status", "requested")
        .select("id")
        .maybeSingle();
      dbError(claimed.error);
      if (!claimed.data) continue;
      const { data: user, error } = await db.auth.admin.getUserById(
        request.user_id,
      );
      if (
        error ||
        user.user?.email?.toLowerCase() !==
          process.env.LIFE_OS_ALLOWED_EMAIL?.toLowerCase()
      )
        throw Error("Account identity needs owner review.");
      const { data: connections, error: connectionError } = await db
        .from("calendar_connections")
        .select("id,status")
        .eq("user_id", request.user_id);
      dbError(connectionError);
      for (const connection of connections ?? [])
        if (connection.status === "connected")
          await revokeGoogleForUser(request.user_id, connection.id);
      const result = await db.auth.admin.deleteUser(request.user_id);
      if (result.error) throw Error("Account deletion failed.");
      summary.deleted++;
    } catch {
      summary.failed++;
      await db
        .from("deletion_requests")
        .update({
          claimed_at: null,
          last_error:
            "Deletion needs attention. Google revocation or account identity could not be confirmed; records were retained for retry.",
        })
        .eq("id", request.id)
        .eq("status", "requested");
    }
  return summary;
}
