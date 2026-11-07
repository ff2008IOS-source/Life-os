import "server-only";
import { ApiError } from "../auth";
import { dbError } from "../http";
import { boundedFileBody } from "../canvas/file-download";
import { connectionAccessForUser, integrationAdmin } from "./google-server";
import { SHEETS_READ_SCOPE } from "./google-oauth";
import { gridSchema, locateSheetRecord, type SheetGrid } from "./sheet-sync";
export async function readSyncSheet(
  user: string,
  connection: string,
  id: string,
  sheetId?: number,
): Promise<SheetGrid> {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(id))
    throw new ApiError(422, "Invalid spreadsheet identity.");
  const { token, scope } = await connectionAccessForUser(user, connection);
  if (!scope.split(" ").includes(SHEETS_READ_SCOPE))
    throw new ApiError(
      409,
      "Reconnect Google with the existing read-only Sheets permission.",
    );
  const get = async (params: Record<string, string>) => {
    const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${id}`);
    url.search = new URLSearchParams(params).toString();
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok)
      throw new ApiError(
        r.status === 403 ? 403 : 502,
        "This spreadsheet could not be read. Check its connection and sharing permissions.",
      );
    return gridSchema.parse(
      JSON.parse(
        new TextDecoder().decode(await boundedFileBody(r, 2 * 1024 * 1024)),
      ),
    );
  };
  const meta = await get({
    fields: "spreadsheetId,properties(title),sheets(properties(sheetId,title))",
  });
  if (meta.spreadsheetId !== id)
    throw new ApiError(502, "Spreadsheet identity mismatch.");
  if (sheetId === undefined) return meta;
  const sheet = meta.sheets.find((s) => s.properties.sheetId === sheetId);
  if (!sheet) throw new ApiError(409, "The mapped worksheet is missing.");
  // Bound the read explicitly. An ID missing from this range is reported for review,
  // never interpreted as permission to delete its Life OS history.
  const grid = await get({
    ranges: `'${sheet.properties.title.replaceAll("'", "''")}'!A1:Z2000`,
    includeGridData: "true",
    fields:
      "spreadsheetId,properties(title),sheets(properties(sheetId,title),protectedRanges,data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue))))",
  });
  return grid;
}
export async function syncSheetSource(
  user: string,
  source: string,
  confirmMapping?: {
    id: string;
    version: number;
    project_version: number;
    remote_value: string;
  },
) {
  const db = integrationAdmin();
  const s = await db
    .from("sheet_sync_sources")
    .select("*")
    .eq("user_id", user)
    .eq("id", source)
    .single();
  dbError(s.error);
  if (!s.data || !["import_only", "two_way"].includes(s.data.mode))
    throw new ApiError(
      409,
      "Incoming synchronization is paused for this source.",
    );
  const maps = await db
    .from("sheet_sync_mappings")
    .select("*")
    .eq("user_id", user)
    .eq("source_id", source)
    .order("id")
    .limit(51);
  dbError(maps.error);
  if ((maps.data?.length ?? 0) > 50)
    throw new ApiError(422, "This source exceeds the verified mapping limit.");
  if (!maps.data?.length)
    throw new ApiError(422, "Map a project status before syncing this source.");
  const grids = new Map<number, SheetGrid>();
  let checked = 0,
    conflicts = 0;
  try {
    for (const m of maps.data ?? []) {
      if (confirmMapping && m.id !== confirmMapping.id) continue;
      let grid = grids.get(m.sheet_id);
      if (!grid) {
        grid = await readSyncSheet(
          user,
          s.data.connection_id,
          s.data.spreadsheet_id,
          m.sheet_id,
        );
        grids.set(m.sheet_id, grid);
      }
      const remote = locateSheetRecord(
        grid,
        m.sheet_id,
        m.id_column,
        m.status_column,
        m.external_id,
        m.remote_values,
      );
      if (remote && !remote.status)
        throw new ApiError(
          409,
          "A mapped spreadsheet status is unknown. Review its field-value mapping.",
        );
      const project = await db
        .from("projects")
        .select("version")
        .eq("user_id", user)
        .eq("id", m.project_id)
        .single();
      dbError(project.error);
      if (
        confirmMapping &&
        (m.version !== confirmMapping.version ||
          project.data!.version !== confirmMapping.project_version ||
          remote?.value !== confirmMapping.remote_value)
      )
        throw new ApiError(
          409,
          "The project or spreadsheet changed since review. Sync and review again.",
        );
      const result = await db.rpc("accept_sheet_status", {
        p_user: user,
        p_mapping: m.id,
        p_mapping_version: m.version,
        p_project_version: project.data!.version,
        p_remote_status: remote?.status ?? null,
        p_remote_value: remote?.value ?? null,
        p_row: remote?.row ?? null,
        p_formula: remote?.formula ?? false,
        p_missing: !remote,
        p_confirm: !!confirmMapping,
      });
      if (result.error?.code === "40001")
        throw new ApiError(
          409,
          "The project changed while syncing. Retry without overwriting it.",
        );
      dbError(result.error);
      checked++;
      if (result.data === "conflict") conflicts++;
    }
    if (confirmMapping && !checked)
      throw new ApiError(404, "The reviewed mapping is missing.");
    const update = await db
      .from("sheet_sync_sources")
      .update({
        last_success_at: new Date().toISOString(),
        last_error: null,
        next_sync_at: new Date(Date.now() + 3600000).toISOString(),
        version: s.data.version + 1,
      })
      .eq("user_id", user)
      .eq("id", source)
      .eq("version", s.data.version);
    dbError(update.error);
    return { checked, conflicts, read_only: true };
  } catch (e) {
    await db
      .from("sheet_sync_sources")
      .update({
        next_sync_at: new Date(Date.now() + 3600000).toISOString(),
        last_error:
          e instanceof ApiError
            ? e.message
            : "Spreadsheet structure or stable IDs need review.",
      })
      .eq("user_id", user)
      .eq("id", source);
    throw e;
  }
}
export async function sheetSyncWorker() {
  const db = integrationAdmin();
  const s = await db
    .from("sheet_sync_sources")
    .select("id,user_id,last_success_at")
    .in("mode", ["import_only", "two_way"])
    .lte("next_sync_at", new Date().toISOString())
    .order("last_success_at", { ascending: true, nullsFirst: true })
    .limit(1);
  dbError(s.error);
  const results = [];
  for (const source of s.data ?? []) {
    if (
      source.last_success_at &&
      Date.now() - Date.parse(source.last_success_at) < 3600000
    )
      continue;
    try {
      results.push(await syncSheetSource(source.user_id, source.id));
    } catch {
      await db
        .from("sheet_sync_sources")
        .update({ next_sync_at: new Date(Date.now() + 3600000).toISOString() })
        .eq("user_id", source.user_id)
        .eq("id", source.id);
      results.push({ failed: true });
    }
  }
  return results;
}
