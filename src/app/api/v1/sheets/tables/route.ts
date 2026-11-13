import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
import { integrationAdmin } from "@/lib/integrations/google-server";
import { withRestSheetsAccess } from "@/lib/integrations/sheets-rest-access";
import {
  readRestMetadata,
  SheetsRestError,
} from "@/lib/integrations/sheets-rest-provider";
import {
  datasetConfig,
  scalar,
  identityValues,
  validateField,
  localPatch,
  type Values,
} from "@/lib/integrations/sheet-ledger-model";
import { contentHash } from "@/lib/integrations/sheet-rest-snapshot";
import {
  ownedDataset,
  ledgerRows,
  synchronizeDataset,
  readDataset,
} from "@/lib/integrations/sheet-rest-server";
import {
  createSheetTest,
  verifySheetTest,
} from "@/lib/integrations/sheet-rest-test";
export const maxDuration = 300;
const id = z.uuid(),
  base = { dataset_id: id },
  confirmed = { confirmed: z.literal(true) };
import { statusValues } from "@/lib/integrations/sheet-sync";
const inputSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("bind_project"),
      ...base,
      row_id: id,
      version: z.number().int(),
      project_id: id,
      project_version: z.number().int(),
      field: z.string().max(64),
      values_map: statusValues,
      ...confirmed,
    })
    .strict(),
  z
    .object({
      action: z.literal("create_test"),
      connection_id: id,
      request_id: id,
      confirmed: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal("verify_test"),
      test_id: id,
      confirmed: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal("metadata"),
      connection_id: id,
      spreadsheet_id: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/),
    })
    .strict(),
  z
    .object({
      action: z.literal("register"),
      connection_id: id,
      spreadsheet_id: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/),
      config: datasetConfig,
      ...confirmed,
    })
    .strict(),
  z.object({ action: z.literal("sync"), ...base }).strict(),
  z
    .object({
      action: z.literal("mode"),
      ...base,
      version: z.number().int(),
      mode: z.enum(["paused", "import_only", "export_only", "two_way"]),
      outbound_enabled: z.boolean(),
      automatic_outbound: z.boolean(),
      ...confirmed,
    })
    .strict(),
  z
    .object({
      action: z.literal("edit"),
      ...base,
      row_id: id,
      version: z.number().int(),
      request_id: id,
      values: z.record(z.string(), scalar),
    })
    .strict(),
  z
    .object({
      action: z.literal("insert"),
      ...base,
      request_id: id,
      values: z.record(z.string(), scalar),
    })
    .strict(),
  z
    .object({
      action: z.literal("delete"),
      ...base,
      row_id: id,
      version: z.number().int(),
      request_id: id,
      ...confirmed,
    })
    .strict(),
  z
    .object({
      action: z.literal("approve"),
      ...base,
      operation_id: id,
      version: z.number().int(),
      ...confirmed,
    })
    .strict(),
  z
    .object({
      action: z.literal("resolve"),
      ...base,
      row_id: id,
      version: z.number().int(),
      field: z.string().max(64),
      keep: z.enum(["local", "remote"]),
      ...confirmed,
    })
    .strict(),
]);
export async function GET(request: Request) {
  try {
    const { db, user } = await authorized();
    const dataset = new URL(request.url).searchParams.get("dataset");
    const sources = await db
      .from("sheet_rest_datasets")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at")
      .limit(21);
    dbError(sources.error);
    if ((sources.data?.length ?? 0) > 20)
      throw new ApiError(422, "More than 20 tables require a narrower query.");
    const tests = await db
      .from("sheet_rest_tests")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5);
    dbError(tests.error);
    if (!dataset)
      return NextResponse.json(
        { datasets: sources.data, tests: tests.data },
        { headers: { "Cache-Control": "no-store" } },
      );
    id.parse(dataset);
    await ownedDataset(user.id, dataset);
    const after = new URL(request.url).searchParams.get("after");
    let query = db
      .from("sheet_rest_rows")
      .select("*")
      .eq("user_id", user.id)
      .eq("dataset_id", dataset)
      .order("id")
      .limit(101);
    if (after) query = query.gt("id", id.parse(after));
    const [rows, ops, runs] = await Promise.all([
      query,
      db
        .from("sheet_rest_operations")
        .select("*")
        .eq("user_id", user.id)
        .eq("dataset_id", dataset)
        .in("status", [
          "draft",
          "approved",
          "writing",
          "unknown",
          "conflict",
          "failed",
        ])
        .order("created_at")
        .limit(101),
      db
        .from("sheet_rest_runs")
        .select("*")
        .eq("user_id", user.id)
        .eq("dataset_id", dataset)
        .order("started_at", { ascending: false })
        .limit(10),
    ]);
    for (const r of [rows, ops, runs]) dbError(r.error);
    return NextResponse.json(
      {
        datasets: sources.data,
        tests: tests.data,
        rows: rows.data!.slice(0, 100),
        next: rows.data!.length > 100 ? rows.data![99].id : null,
        operations: ops.data!.slice(0, 100),
        more_operations: ops.data!.length > 100,
        runs: runs.data,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { user } = await authorized();
    const input = inputSchema.parse(await readJson(request));
    const db = integrationAdmin();
    if (input.action === "create_test")
      return NextResponse.json(
        await createSheetTest(user.id, input.connection_id, input.request_id),
      );
    if (input.action === "verify_test")
      return NextResponse.json(await verifySheetTest(user.id, input.test_id));
    if (input.action === "metadata") {
      const metadata = await withRestSheetsAccess(
        user.id,
        input.connection_id,
        false,
        (token) => readRestMetadata(token, input.spreadsheet_id),
      );
      return NextResponse.json(metadata);
    }
    if (input.action === "register") {
      const metadata = await withRestSheetsAccess(
        user.id,
        input.connection_id,
        false,
        (token) => readRestMetadata(token, input.spreadsheet_id),
      );
      const sheet = metadata.sheets.find(
        (s) => s.properties.sheetId === input.config.sheet_id,
      );
      if (!sheet) throw new ApiError(422, "Select an existing worksheet.");
      if (
        input.config.end_row > sheet.properties.gridProperties.rowCount ||
        input.config.end_column > sheet.properties.gridProperties.columnCount
      )
        throw new ApiError(422, "The configured range exceeds this worksheet.");
      const source = await db
        .from("data_sources")
        .upsert(
          {
            user_id: user.id,
            provider: "google_sheets",
            source_key: input.spreadsheet_id,
            reference_url: `https://docs.google.com/spreadsheets/d/${input.spreadsheet_id}/edit`,
          },
          { onConflict: "user_id,provider,source_key" },
        )
        .select("id")
        .single();
      dbError(source.error);
      const dataset = await db
        .from("sheet_rest_datasets")
        .insert({
          user_id: user.id,
          connection_id: input.connection_id,
          source_id: source.data!.id,
          spreadsheet_id: input.spreadsheet_id,
          worksheet_id: input.config.sheet_id,
          title: metadata.properties.title,
          worksheet_title: sheet.properties.title,
          config: input.config,
        })
        .select("id")
        .single();
      dbError(dataset.error);
      return NextResponse.json({
        dataset_id: dataset.data!.id,
        ...(await synchronizeDataset(user.id, dataset.data!.id)),
      });
    }
    const d = await ownedDataset(user.id, input.dataset_id);
    if (input.action === "bind_project") {
      const r = await db.rpc("bind_sheet_rest_project", {
        p_user: user.id,
        p_dataset: d.id,
        p_row: input.row_id,
        p_version: input.version,
        p_project: input.project_id,
        p_project_version: input.project_version,
        p_field: input.field,
        p_map: input.values_map,
      });
      dbError(r.error);
      return NextResponse.json({ linked: true });
    }
    if (input.action === "sync")
      return NextResponse.json(await synchronizeDataset(user.id, d.id));
    if (input.action === "mode") {
      if (input.automatic_outbound && !input.outbound_enabled)
        throw new ApiError(
          422,
          "Enable outbound writes before automatic approval.",
        );
      if (input.outbound_enabled) {
        const tests = await db
          .from("sheet_rest_tests")
          .select("id")
          .eq("user_id", user.id)
          .eq("connection_id", d.connection_id)
          .eq("status", "verified")
          .limit(1);
        dbError(tests.error);
        if (!tests.data?.length)
          throw new ApiError(
            409,
            "Complete the disposable workbook verification before activating writes.",
          );
        await withRestSheetsAccess(
          user.id,
          d.connection_id,
          true,
          async () => true,
        );
      }
      const r = await db
        .from("sheet_rest_datasets")
        .update({
          mode: input.mode,
          outbound_enabled: input.outbound_enabled,
          automatic_outbound: input.automatic_outbound,
          production_approved_at: input.outbound_enabled
            ? new Date().toISOString()
            : null,
        })
        .eq("user_id", user.id)
        .eq("id", d.id)
        .eq("version", input.version)
        .or("lease_until.is.null,lease_until.lt." + new Date().toISOString())
        .select("id");
      dbError(r.error);
      if (!r.data?.length)
        throw new ApiError(
          409,
          "The connection changed or is syncing. Refresh and try again.",
        );
      return NextResponse.json({ saved: true });
    }
    if (input.action === "resolve") {
      const r = await db.rpc("resolve_sheet_rest", {
        p_user: user.id,
        p_dataset: d.id,
        p_row: input.row_id,
        p_version: input.version,
        p_field: input.field,
        p_keep: input.keep,
      });
      dbError(r.error);
      return NextResponse.json({ resolved: true });
    }
    if (input.action === "approve") {
      const r = await db.rpc("approve_sheet_rest", {
        p_user: user.id,
        p_dataset: d.id,
        p_operation: input.operation_id,
        p_version: input.version,
      });
      dbError(r.error);
      return NextResponse.json({ approved: true });
    }
    const config = datasetConfig.parse(d.config),
      rows = await ledgerRows(d);
    const row =
      input.action === "insert"
        ? null
        : rows.find((r) => r.id === input.row_id);
    if (input.action !== "insert" && !row)
      throw new ApiError(404, "Owned source record missing.");
    let values: Values =
      input.action === "delete"
        ? Object.fromEntries(config.columns.map((c) => [c.key, null]))
        : input.values;
    if (input.action !== "delete")
      for (const [k, v] of Object.entries(values)) {
        const c = config.columns.find((c) => c.key === k);
        if (
          !c ||
          (input.action === "edit" && (!c.writable || c.key_part)) ||
          (input.action === "insert" && !c.writable && !c.key_part)
        )
          throw new ApiError(403, "Unmapped, identity or source-owned field.");
        validateField(c, v, row?.remote_cells[k]);
      }
    if (input.action === "edit" && row) {
      if (Object.keys(row.conflicts as object).length)
        throw new ApiError(409, "Resolve conflicts before editing.");
      values = {
        ...localPatch(row.baseline, row.local_values, config),
        ...values,
      };
      values = Object.fromEntries(
        Object.entries(values).filter(
          ([k, v]) =>
            JSON.stringify(v) !==
            JSON.stringify(row.baseline[k]?.value ?? null),
        ),
      );
      if (!Object.keys(values).length)
        throw new ApiError(422, "No changed fields.");
    }
    if (input.action === "insert") {
      identityValues(config, values);
      const snapshot = await readDataset(d);
      if (
        snapshot.rows.some(
          (r) => r.external_key === contentHash(identityValues(config, values)),
        )
      )
        throw new ApiError(409, "This stable identity already exists.");
    }
    const key =
      input.action === "insert"
        ? identityValues(config, values)
        : row!.key_values;
    const r = await db.rpc("edit_sheet_rest", {
      p_user: user.id,
      p_dataset: d.id,
      p_row: row?.id ?? input.request_id,
      p_version: "version" in input ? input.version : 0,
      p_request: input.request_id,
      p_type: input.action === "edit" ? "update" : input.action,
      p_values: values,
      p_key: contentHash(key),
      p_key_values: key,
    });
    dbError(r.error);
    return NextResponse.json({ operation_id: r.data, pending: true });
  } catch (e) {
    if (e instanceof SheetsRestError)
      return failure(new ApiError(409, e.message, e.code));
    return failure(e);
  }
}
