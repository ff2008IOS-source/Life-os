import "server-only";
import { randomUUID } from "node:crypto";
import { integrationAdmin } from "./google-server";
import { withRestSheetsAccess } from "./sheets-rest-access";
import {
  createRestTestWorkbook,
  writeRestCells,
  sheetsRestRequest,
} from "./sheets-rest-provider";
import { datasetConfig, type Values } from "./sheet-ledger-model";
import {
  ownedDataset,
  ledgerRows,
  synchronizeDataset,
  readDataset,
} from "./sheet-rest-server";
import { contentHash } from "./sheet-rest-snapshot";
import { dbError } from "../http";
import { ApiError } from "../auth";
export const testConfig = datasetConfig.parse({
  sheet_id: 0,
  header_row: 0,
  end_row: 50,
  start_column: 0,
  end_column: 6,
  allow_insert: true,
  allow_delete: true,
  columns: [
    { key: "id", header: "Record ID", type: "text", key_part: true },
    { key: "name", header: "Player", type: "text", writable: true },
    { key: "made", header: "Made", type: "integer", writable: true },
    { key: "attempted", header: "Attempted", type: "integer", writable: true },
    { key: "accuracy", header: "Accuracy", type: "number" },
  ],
});
export async function createSheetTest(
  user: string,
  connection: string,
  request: string,
) {
  const db = integrationAdmin();
  const existing = await db
    .from("sheet_rest_tests")
    .select("*")
    .eq("user_id", user)
    .eq("id", request)
    .maybeSingle();
  dbError(existing.error);
  if (existing.data) return existing.data;
  const recent = await db
    .from("sheet_rest_tests")
    .select("id")
    .eq("user_id", user)
    .gte("created_at", new Date(Date.now() - 86400000).toISOString())
    .limit(5);
  dbError(recent.error);
  if (recent.data!.length >= 5)
    throw new ApiError(
      429,
      "At most five disposable workbook creations per day. Reuse an existing test.",
    );
  await withRestSheetsAccess(user, connection, true, async () => true);
  const intent = await db.from("sheet_rest_tests").insert({
    id: request,
    user_id: user,
    connection_id: connection,
    status: "creating",
  });
  dbError(intent.error);
  try {
    const workbook = await withRestSheetsAccess(
      user,
      connection,
      true,
      (token) => createRestTestWorkbook(token, request),
    );
    const saved = await db
      .from("sheet_rest_tests")
      .update({
        spreadsheet_id: workbook.spreadsheetId,
        spreadsheet_url: workbook.spreadsheetUrl,
        status: "ready",
      })
      .eq("id", request);
    dbError(saved.error);
    const source = await db
      .from("data_sources")
      .insert({
        user_id: user,
        provider: "google_sheets",
        source_key: workbook.spreadsheetId,
        reference_url: workbook.spreadsheetUrl,
      })
      .select("id")
      .single();
    dbError(source.error);
    const dataset = await db
      .from("sheet_rest_datasets")
      .insert({
        user_id: user,
        connection_id: connection,
        source_id: source.data!.id,
        spreadsheet_id: workbook.spreadsheetId,
        worksheet_id: 0,
        title: "[TEST] Life OS Sheets verification",
        worksheet_title: "Sync Test",
        config: testConfig,
        test_only: true,
        mode: "two_way",
        outbound_enabled: true,
      })
      .select("id")
      .single();
    dbError(dataset.error);
    const done = await db
      .from("sheet_rest_tests")
      .update({ dataset_id: dataset.data!.id })
      .eq("id", request)
      .select("*")
      .single();
    dbError(done.error);
    return done.data;
  } catch {
    await db
      .from("sheet_rest_tests")
      .update({
        status: "unknown",
        last_error:
          "Creation or setup was not confirmed. Do not automatically create another workbook; inspect the saved test link or Google Drive.",
      })
      .eq("id", request);
    throw new ApiError(
      409,
      "Disposable workbook creation/setup was not confirmed. Reuse this test record and inspect its saved link before retrying.",
    );
  }
}
/** Runs only against a server-created synthetic workbook, never a user-supplied production ID. */
export async function verifySheetTest(user: string, test: string) {
  const db = integrationAdmin();
  const saved = await db
    .from("sheet_rest_tests")
    .select("*")
    .eq("user_id", user)
    .eq("id", test)
    .single();
  dbError(saved.error);
  const t = saved.data;
  if (!t?.dataset_id) throw new ApiError(409, "Test workbook is not ready.");
  if (t.status === "verified") return t;
  const d = await ownedDataset(user, t.dataset_id);
  if (!d.test_only || d.spreadsheet_id !== t.spreadsheet_id)
    throw new ApiError(
      403,
      "Only a server-created disposable workbook can run this verification.",
    );
  const results: Record<string, boolean> = {};
  const assert = (v: unknown, name: string) => {
    if (!v) throw Error(name);
    results[name] = true;
  };
  const sync = () => synchronizeDataset(user, d.id);
  const edit = async (rowId: string, type: string, values: Values) => {
    const row = (await ledgerRows(d)).find((r) => r.id === rowId);
    const op = randomUUID();
    const r = await db.rpc("edit_sheet_rest", {
      p_user: user,
      p_dataset: d.id,
      p_row: rowId,
      p_version: row?.version ?? 0,
      p_request: op,
      p_type: type,
      p_values: values,
      p_key: type === "insert" ? contentHash([values.id]) : null,
      p_key_values: type === "insert" ? [values.id] : null,
    });
    dbError(r.error);
    const approve = await db.rpc("approve_sheet_rest", {
      p_user: user,
      p_dataset: d.id,
      p_operation: op,
      p_version: 1,
    });
    dbError(approve.error);
    return op;
  };
  try {
    await sync();
    let rows = await ledgerRows(d);
    const first = rows.find(
      (r) =>
        r.key_values && JSON.stringify(r.key_values) === '["test-player-1"]',
    );
    if (!first) throw Error("Synthetic fixture missing");
    assert(rows.length === 1, "initial_import");
    const original = await readDataset(d);
    const formula = original.cell(first.row_locator!, 4);
    assert(!!formula.formula && !formula.writable, "formula_read_only");
    await edit(first.id, "update", { made: 5 });
    await sync();
    assert(
      (await readDataset(d)).rows.find(
        (r) => r.external_key === first.external_key,
      )?.values.made === 5,
      "outbound_update",
    );
    await withRestSheetsAccess(user, d.connection_id, true, (token) =>
      writeRestCells(token, d.spreadsheet_id, [
        { range: "'Sync Test'!C2:C2", value: 6 },
      ]),
    );
    await sync();
    assert(
      (await ledgerRows(d)).find((r) => r.id === first.id)?.local_values
        .made === 6,
      "inbound_update",
    );
    await edit(first.id, "update", { made: 7 });
    await withRestSheetsAccess(user, d.connection_id, true, (token) =>
      writeRestCells(token, d.spreadsheet_id, [
        { range: "'Sync Test'!C2:C2", value: 8 },
      ]),
    );
    await sync();
    const conflict = (await ledgerRows(d)).find((r) => r.id === first.id)!;
    assert(
      Object.hasOwn(conflict.conflicts as object, "made"),
      "simultaneous_edit_conflict",
    );
    const resolution = await db.rpc("resolve_sheet_rest", {
      p_user: user,
      p_dataset: d.id,
      p_row: first.id,
      p_version: conflict.version,
      p_field: "made",
      p_keep: "remote",
    });
    dbError(resolution.error);
    await sync();
    assert(
      (await ledgerRows(d)).find((r) => r.id === first.id)?.local_values
        .made === 8,
      "conflict_resolution",
    );
    const newRow = randomUUID();
    await edit(newRow, "insert", {
      id: "test-player-2",
      name: "[TEST] Second record",
      made: 1,
      attempted: 2,
    });
    await sync();
    assert((await readDataset(d)).rows.length === 2, "insert_record");
    await withRestSheetsAccess(user, d.connection_id, true, (token) =>
      sheetsRestRequest(
        token,
        `/v4/spreadsheets/${d.spreadsheet_id}:batchUpdate`,
        {
          method: "POST",
          write: true,
          body: {
            requests: [
              {
                moveDimension: {
                  source: {
                    sheetId: 0,
                    dimension: "ROWS",
                    startIndex: 2,
                    endIndex: 3,
                  },
                  destinationIndex: 1,
                },
              },
            ],
          },
        },
      ),
    );
    await sync();
    rows = await ledgerRows(d);
    assert(
      rows.find((r) => r.id === first.id)?.row_locator === 2 &&
        rows.length === 2,
      "row_reorder_stable_identity",
    );
    await edit(
      newRow,
      "delete",
      Object.fromEntries(testConfig.columns.map((c) => [c.key, null])),
    );
    await sync();
    assert(
      (await ledgerRows(d)).find((r) => r.id === newRow)?.state === "deleted",
      "approved_deletion_preserves_history",
    );
    const after = await readDataset(d);
    const actual = after.rows.find(
      (r) => r.external_key === first.external_key,
    )!;
    assert(!!after.cell(actual.row_locator, 4).formula, "formula_preserved");
    assert(
      after.cell(actual.row_locator, 5).value === "[TEST] Preserve this cell",
      "unrelated_cell_preserved",
    );
    assert(
      after.raw[actual.row_locator]?.[4]?.userEnteredFormat?.numberFormat !==
        undefined,
      "format_preserved",
    );
    await sync();
    assert((await ledgerRows(d)).length === 2, "repeat_without_duplicates");
    const done = await db
      .from("sheet_rest_tests")
      .update({ status: "verified", results, last_error: null })
      .eq("id", test)
      .select("*")
      .single();
    dbError(done.error);
    return done.data;
  } catch (e) {
    await db
      .from("sheet_rest_tests")
      .update({
        status: "failed",
        results,
        last_error:
          "Synthetic verification stopped. Review run history before restarting.",
      })
      .eq("id", test);
    throw e;
  }
}
