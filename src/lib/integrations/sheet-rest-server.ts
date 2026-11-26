import { sheetSyncDiagnostic } from "./sheet-sync-diagnostic";
import "server-only";
import { randomUUID } from "node:crypto";
import { ApiError } from "../auth";
import { dbError } from "../http";
import { integrationAdmin } from "./google-server";
import { withRestSheetsAccess } from "./sheets-rest-access";
import {
  readRestCells,
  writeRestCells,
  SheetsRestError,
} from "./sheets-rest-provider";
import { parseRestSnapshot, type TableSnapshot } from "./sheet-rest-snapshot";
import {
  datasetConfig,
  mergeSheetFields,
  localPatch,
  type Cells,
  type Values,
} from "./sheet-ledger-model";
import { planRestWrite } from "./sheet-rest-plan";
import { syncAndCorrect } from "./sheet-owned";
export type Dataset = {
  id: string;
  user_id: string;
  connection_id: string;
  spreadsheet_id: string;
  config: unknown;
  mode: string;
  outbound_enabled: boolean;
  automatic_outbound: boolean;
  test_only: boolean;
  attempts: number;
  owner_since?: string | null;
};
export type LedgerRow = {
  id: string;
  external_key: string;
  key_values: unknown;
  version: number;
  frozen?: boolean;
  baseline: Cells;
  remote_cells: Cells;
  local_values: Values;
  conflicts: unknown;
  state: string;
  row_locator: number | null;
  remote_hash: string | null;
};
export async function ownedDataset(user: string, id: string) {
  const r = await integrationAdmin()
    .from("sheet_rest_datasets")
    .select("*")
    .eq("user_id", user)
    .eq("id", id)
    .single();
  dbError(r.error);
  if (!r.data) throw new ApiError(404, "Owned spreadsheet table not found.");
  return r.data as Dataset;
}
export async function readDataset(d: Dataset) {
  const config = datasetConfig.parse(d.config);
  return withRestSheetsAccess(
    d.user_id,
    d.connection_id,
    false,
    async (token) =>
      parseRestSnapshot(
        (await readRestCells(token, d.spreadsheet_id, config.sheet_id, config))
          .grid,
        d.spreadsheet_id,
        config,
      ),
  );
}
export async function ledgerRows(d: Dataset) {
  const rows: LedgerRow[] = [];
  for (let offset = 0; offset <= 5000; offset += 500) {
    const r = await integrationAdmin()
      .from("sheet_rest_rows")
      .select("*")
      .eq("user_id", d.user_id)
      .eq("dataset_id", d.id)
      .order("id")
      .range(offset, offset + 499);
    dbError(r.error);
    rows.push(...(r.data as LedgerRow[]));
    if (r.data!.length < 500) return rows;
  }
  throw new ApiError(422, "Table exceeds the supported record limit.");
}
export function ingestionRows(
  d: Dataset,
  snapshot: TableSnapshot,
  existing: LedgerRow[],
  links: {
    row_id: string;
    field_key: string;
    values_map: Record<string, string>;
  }[] = [],
  authored: Map<string, Set<string>> = new Map(),
) {
  const byKey = new Map(existing.map((r) => [r.external_key, r]));
  const seen = new Set<string>();
  const result = [];
  for (const remote of snapshot.rows) {
    seen.add(remote.external_key);
    const local = byKey.get(remote.external_key);
    if (local?.state === "deleted")
      throw Error(
        "A previously deleted source identity reappeared. Review it before importing.",
      );
    const merged = local
      ? mergeSheetFields(
          local.baseline,
          local.local_values,
          remote.cells,
          d.mode,
          d.mode === "life_os_owned" && !!local?.frozen,
          authored.get(local.id),
        )
      : { values: remote.values, baseline: remote.cells, conflicts: {} };
    const link = links.find((l) => l.row_id === local?.id);
    if (
      link &&
      !Object.values(link.values_map).includes(
        String(merged.values[link.field_key] ?? ""),
      )
    ) {
      merged.conflicts[link.field_key] = {
        base: local?.baseline[link.field_key]?.value ?? null,
        local: merged.values[link.field_key],
        remote: remote.values[link.field_key],
        reason: "unsupported_project_status",
      };
    }
    result.push({
      id: local?.id ?? randomUUID(),
      external_key: remote.external_key,
      key_values: remote.key_values,
      row_locator: remote.row_locator,
      baseline: merged.baseline,
      local_values: merged.values,
      conflicts: merged.conflicts,
      remote_cells: remote.cells,
      remote_hash: remote.remote_hash,
      remote_missing: false,
      state: Object.keys(merged.conflicts).length
        ? "conflict"
        : Object.keys(
              localPatch(merged.baseline, merged.values, snapshot.config),
            ).length
          ? "pending"
          : "synced",
      expected_version: local?.version ?? null,
    });
  }
  for (const r of existing) {
    if (seen.has(r.external_key)) continue;
    result.push({
      ...r,
      expected_version: r.version,
      remote_missing: true,
      state:
        r.state === "deleted"
          ? "deleted"
          : r.state === "draft_new"
            ? "draft_new"
            : "source_missing",
    });
  }
  return result;
}
export async function synchronizeDataset(user: string, id: string) {
  const db = integrationAdmin(),
    d = await ownedDataset(user, id),
    lease = randomUUID();
  const claim = await db.rpc("claim_sheet_rest", {
    p_user: user,
    p_dataset: id,
    p_lease: lease,
  });
  dbError(claim.error);
  if (!claim.data)
    throw new ApiError(
      409,
      "This table is paused, syncing, or waiting for its retry window.",
    );
  const run = await db
    .from("sheet_rest_runs")
    .insert({ user_id: user, dataset_id: id, status: "running" })
    .select("id")
    .single();
  dbError(run.error);
  const updateOp = async (op: string, values: Record<string, unknown>) => {
    const r = await db
      .from("sheet_rest_operations")
      .update(values)
      .eq("user_id", user)
      .eq("dataset_id", id)
      .eq("id", op);
    dbError(r.error);
  };
  let confirmed = 0,
    held = 0;
  try {
    const operations = await db
      .from("sheet_rest_operations")
      .select("*")
      .eq("user_id", user)
      .eq("dataset_id", id)
      .in("status", ["approved", "writing", "unknown"])
      .lte("next_attempt_at", new Date().toISOString())
      .order("created_at")
      .limit(1);
    dbError(operations.error);
    let snapshot = await readDataset(d);
    for (const op of operations.data ?? []) {
      if (
        !d.outbound_enabled ||
        !["two_way", "export_only", "life_os_owned"].includes(d.mode)
      )
        continue;
      const row = (await ledgerRows(d)).find((r) => r.id === op.row_id);
      if (!row) throw Error("The approved local record is unavailable.");
      try {
        // Fresh full bounded snapshot, including identity, formulas and protections, immediately before each batch.
        snapshot = await readDataset(d);
        const plan = planRestWrite(snapshot, {
          ...op,
          external_key: row.external_key,
          uncertain: ["writing", "unknown"].includes(op.status),
        });
        if (!plan.converged) {
          const writing = await db
            .from("sheet_rest_operations")
            .update({
              status: "writing",
              attempts: op.attempts + 1,
              preflight: { hash: snapshot.hash, row: plan.row },
            })
            .eq("id", op.id)
            .eq("version", op.version)
            .select("id");
          dbError(writing.error);
          if (!writing.data?.length)
            throw Error("The approved operation changed.");
          await withRestSheetsAccess(user, d.connection_id, true, (token) =>
            writeRestCells(token, d.spreadsheet_id, plan.changes),
          );
          const verified = await readDataset(d);
          const after = verified.rows.find(
            (r) => r.external_key === row.external_key,
          );
          const okay =
            op.operation_type === "delete"
              ? !after
              : !!after &&
                Object.entries(op.intended as Values).every(
                  ([k, v]) =>
                    JSON.stringify(after.values[k]) === JSON.stringify(v),
                );
          if (!okay)
            throw new SheetsRestError(
              "UNKNOWN_OUTCOME",
              "The provider accepted a write but its intended state was not verified. Review required.",
            );
          snapshot = verified;
        }
        const finish = await db.rpc("finish_sheet_rest", {
          p_user: user,
          p_dataset: id,
          p_operation: op.id,
          p_lease: lease,
          p_accepted: !plan.converged,
          p_deleted: op.operation_type === "delete",
        });
        dbError(finish.error);
        confirmed++;
      } catch (e) {
        if (e instanceof SheetsRestError) {
          await updateOp(op.id, {
            status:
              e.code === "UNKNOWN_OUTCOME"
                ? "unknown"
                : e.retryable
                  ? "approved"
                  : "failed",
            last_error: e.message,
            next_attempt_at: new Date(
              Date.now() +
                Math.max(
                  e.retryAfterSeconds,
                  Math.min(3600, 60 * 2 ** Math.min(op.attempts, 6)),
                ) *
                  1000,
            ).toISOString(),
          });
          throw e;
        }
        held++;
        await updateOp(op.id, {
          status: "conflict",
          last_error:
            "Source changed or a formula/protection prevents the approved write. Sync and review the record.",
        });
      }
    }
    // Commit all incoming field merges atomically; concurrent local changes cause rollback.
    const links = await db
      .from("sheet_rest_project_links")
      .select("row_id,field_key,values_map")
      .eq("user_id", user)
      .eq("dataset_id", id);
    dbError(links.error);
    const authored = new Map<string, Set<string>>();
    if (d.mode === "life_os_owned") {
      const written = await db
        .from("sheet_rest_operations")
        .select("row_id,intended")
        .eq("user_id", user)
        .eq("dataset_id", id)
        .eq("status", "confirmed")
        .in("operation_type", ["update", "insert"]);
      dbError(written.error);
      for (const w of written.data ?? [])
        authored.set(
          w.row_id,
          new Set([
            ...(authored.get(w.row_id) ?? []),
            ...Object.keys(w.intended as object),
          ]),
        );
    }
    const records = ingestionRows(
      d,
      snapshot,
      await ledgerRows(d),
      links.data!,
      authored,
    );
    const ingest = await db.rpc("ingest_sheet_rest", {
      p_user: user,
      p_dataset: id,
      p_lease: lease,
      p_rows: records,
      p_hash: snapshot.hash,
    });
    dbError(ingest.error);
    const blocked = await db
      .from("sheet_rest_operations")
      .select("id")
      .eq("user_id", user)
      .eq("dataset_id", id)
      .in("status", [
        "draft",
        "approved",
        "writing",
        "conflict",
        "failed",
        "unknown",
      ])
      .limit(1);
    dbError(blocked.error);
    held = Math.max(held, blocked.data?.length ?? 0);
    const conflicts = records.filter(
      (r) => r.state === "conflict" || r.state === "source_missing",
    ).length;
    const done = await db
      .from("sheet_rest_runs")
      .update({
        status: conflicts || held ? "partial" : "completed",
        summary: {
          checked: records.length,
          changed: ingest.data,
          confirmed,
          conflicts,
          held_outbound: held > 0,
        },
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.data!.id);
    dbError(done.error);
    const next = await db
      .from("sheet_rest_datasets")
      .update({ next_sync_at: new Date(Date.now() + 3600000).toISOString() })
      .eq("id", id)
      .eq("lease_token", lease);
    dbError(next.error);
    return {
      checked: records.length,
      changed: ingest.data,
      confirmed,
      conflicts,
      held_outbound: held > 0,
    };
  } catch (e) {
    const known = e instanceof SheetsRestError;
    const diagnostic = sheetSyncDiagnostic(e);
    const message = diagnostic.message;
    await db
      .from("sheet_rest_datasets")
      .update({
        last_error: message,
        last_error_code: diagnostic.code,
        attempts: d.attempts + 1,
        next_sync_at: new Date(
          Date.now() +
            Math.max(
              known ? e.retryAfterSeconds : 60,
              Math.min(21600, 60 * 2 ** Math.min(d.attempts + 1, 8)),
            ) *
              1000,
        ).toISOString(),
      })
      .eq("id", id)
      .eq("lease_token", lease);
    await db
      .from("sheet_rest_runs")
      .update({
        status: "failed",
        last_error: message,
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.data!.id);
    throw new ApiError(
      known && e.code === "PERMISSION" ? 403 : 409,
      message,
      diagnostic.code,
    );
  } finally {
    await db
      .from("sheet_rest_datasets")
      .update({ lease_token: null, lease_until: null })
      .eq("id", id)
      .eq("lease_token", lease);
  }
}
export async function restSheetsWorker() {
  const r = await integrationAdmin()
    .from("sheet_rest_datasets")
    .select("id,user_id")
    .neq("mode", "paused")
    .eq("test_only", false)
    .lte("next_sync_at", new Date().toISOString())
    .order("next_sync_at")
    .limit(1);
  dbError(r.error);
  const results = [];
  for (const d of r.data ?? [])
    try {
      results.push(await syncAndCorrect(d.user_id, d.id));
    } catch {
      results.push({ failed: true });
    }
  return results;
}
