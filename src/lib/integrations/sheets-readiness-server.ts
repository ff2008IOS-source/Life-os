import "server-only";
import { integrationAdmin, connectionAccessForUser } from "./google-server";
import { SHEETS_WRITE_SCOPE } from "./google-oauth";
import { readRevisionSheet, SheetProviderError } from "./sheets-provider";
import { CAREER_SHEET_ID } from "./sheets-server";
import { dbError } from "../http";
export async function sheetsReadinessForUser(user: string, connection: string) {
  const access = await connectionAccessForUser(user, connection);
  const write = access.scope.split(" ").includes(SHEETS_WRITE_SCOPE);
  try {
    await readRevisionSheet(access.token, CAREER_SHEET_ID, [
      "'Skills & Portfolio'!H5:K25",
    ]);
    return {
      connection_id: connection,
      write_permission: write,
      provider_read_revision: true,
      conditional_write_verified: false,
      status: write ? "READY_FOR_TEST" : "WRITE_PERMISSION_REQUIRED",
      message: write
        ? "A synthetic workbook test is required before activating outbound updates."
        : "Connect Google Sheets write permission to continue.",
    };
  } catch (e) {
    return {
      connection_id: connection,
      write_permission: write,
      provider_read_revision: false,
      conditional_write_verified: false,
      status: e instanceof SheetProviderError ? e.code : "PROVIDER_UNAVAILABLE",
      message:
        e instanceof SheetProviderError
          ? e.message
          : "Sheets readiness could not be verified.",
    };
  }
}
export async function sheetsReadinessWorker() {
  const db = integrationAdmin();
  const rows = await db
    .from("calendar_connections")
    .select("id,user_id")
    .eq("status", "connected")
    .limit(2);
  dbError(rows.error);
  if ((rows.data?.length ?? 0) > 1)
    throw Error("Single-owner Google connection limit exceeded");
  const result = [];
  for (const row of rows.data ?? [])
    result.push(await sheetsReadinessForUser(row.user_id, row.id));
  return result;
}
