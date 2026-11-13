import "server-only";
import { connectionAccessForUser } from "./google-server";
import { hasSheetsReadAccess, SHEETS_WRITE_SCOPE } from "./google-oauth";
import { SheetsRestError } from "./sheets-rest-provider";
export async function withRestSheetsAccess<T>(
  user: string,
  connection: string,
  write: boolean,
  operation: (token: string) => Promise<T>,
  access: (
    user: string,
    connection: string,
    force?: boolean,
  ) => Promise<{ scope: string; token: string }> = connectionAccessForUser,
): Promise<T> {
  const run = async (force = false) => {
    const credential = await access(user, connection, force);
    if (
      write
        ? !credential.scope.split(" ").includes(SHEETS_WRITE_SCOPE)
        : !hasSheetsReadAccess(credential.scope)
    )
      throw new SheetsRestError(
        "PERMISSION",
        write
          ? "Authorize Google Sheets write permission in the secure integration settings."
          : "Authorize Google Sheets read permission in the secure integration settings.",
      );
    return operation(credential.token);
  };
  try {
    return await run();
  } catch (e) {
    if (e instanceof SheetsRestError && e.code === "AUTH_REQUIRED")
      return run(true);
    throw e;
  }
}
