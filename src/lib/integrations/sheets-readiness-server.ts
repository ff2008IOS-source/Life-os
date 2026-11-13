import "server-only";
import { connectionAccessForUser, integrationAdmin } from "./google-server";
import {
  hasSheetsReadAccess,
  SHEETS_WRITE_SCOPE,
  CALENDAR_WRITE_SCOPE,
} from "./google-oauth";
import { dbError } from "../http";
export async function sheetsReadinessForUser(user: string, connection: string) {
  const c = await connectionAccessForUser(user, connection);
  const write = c.scope.split(" ").includes(SHEETS_WRITE_SCOPE);
  return {
    connection_id: connection,
    write_permission: write,
    calendar_write_permission: c.scope
      .split(" ")
      .includes(CALENDAR_WRITE_SCOPE),
    read_permission: hasSheetsReadAccess(c.scope),
    provider: "Google Sheets REST API v4",
    atomic_conditional_writes: false,
    status: write ? "READY_FOR_TEST" : "WRITE_PERMISSION_REQUIRED",
    message: write
      ? "REST permission is present. Run the disposable workbook verification before activating outbound writes."
      : "Authorize Sheets write permission securely in settings.",
  };
}
export async function sheetsReadinessWorker() {
  const r = await integrationAdmin()
    .from("calendar_connections")
    .select("id,user_id")
    .eq("status", "connected")
    .limit(2);
  dbError(r.error);
  if ((r.data?.length ?? 0) > 1)
    throw Error("Single-owner connection limit exceeded");
  return Promise.all(
    (r.data ?? []).map((c) => sheetsReadinessForUser(c.user_id, c.id)),
  );
}
