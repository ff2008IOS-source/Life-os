import { ApiError } from "../auth";
import { SheetsRestError } from "./sheets-rest-provider";
/** Only known, safe diagnostics leave the server. Provider bodies, tokens and cell values never do. */
export function sheetSyncDiagnostic(error: unknown) {
  if (error instanceof SheetsRestError)
    return { code: error.code, message: error.message };
  if (
    error instanceof ApiError &&
    [
      "GOOGLE_RECONNECT",
      "GOOGLE_INVALID_CLIENT",
      "GOOGLE_SETUP_REQUIRED",
    ].includes(error.code)
  )
    return { code: error.code, message: error.message };
  const text = error instanceof Error ? error.message : "";
  if (text === "Reconnect this Google account.")
    return {
      code: "GOOGLE_RECONNECT",
      message:
        "Google authorization needs renewal. Reconnect Google securely in Settings.",
    };
  if (/header missing|worksheet is missing|source range changed/i.test(text))
    return {
      code: "MAPPING_REVIEW",
      message:
        "The worksheet layout no longer matches its approved mapping. Review its headers and range in connection settings.",
    };
  if (/identity|stable source/i.test(text))
    return {
      code: "IDENTITY_REVIEW",
      message:
        "Some source rows cannot be matched safely. Review missing or duplicate identifiers before syncing.",
    };
  if (/Invalid value for|permitted value/i.test(text))
    return {
      code: "VALUE_REVIEW",
      message:
        "A source value does not match the approved field type or options. Review the table mapping.",
    };
  if (error instanceof ApiError)
    return {
      code: "LOCAL_SYNC_ERROR",
      message:
        "Life OS could not complete its local sync checks. Existing records were kept; retry or inspect the sync history.",
    };
  return {
    code: "SYNC_CHECK_FAILED",
    message:
      "Life OS stopped the refresh during its safety checks. Existing records were kept. Check the sync history for the affected table.",
  };
}
