import { sheetsReadinessForUser } from "@/lib/integrations/sheets-readiness-server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
import { integrationAdmin } from "@/lib/integrations/google-server";
import {
  readSyncSheet,
  syncSheetSource,
} from "@/lib/integrations/sheet-sync-server";
import { locateSheetRecord, statusValues } from "@/lib/integrations/sheet-sync";
export const maxDuration = 120;
export async function GET() {
  try {
    const { db, user } = await authorized();
    const [sources, mappings, pending] = await Promise.all([
      db
        .from("sheet_sync_sources")
        .select("*")
        .eq("user_id", user.id)
        .limit(20),
      db
        .from("sheet_sync_mappings")
        .select("*")
        .eq("user_id", user.id)
        .limit(100),
      db
        .from("sheet_sync_outbox")
        .select("id,mapping_id,status,created_at,last_error")
        .eq("user_id", user.id)
        .eq("status", "pending")
        .limit(100),
    ]);
    for (const r of [sources, mappings, pending]) dbError(r.error);
    return NextResponse.json(
      {
        sources: sources.data,
        mappings: mappings.data,
        pending: pending.data,
        outbound_available: false,
        outbound_requirement:
          "Legacy mappings remain import-only. Configure REST table synchronization for reviewed outbound updates.",
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
    const input = z
      .discriminatedUnion("action", [
        z
          .object({ action: z.literal("probe"), connection_id: z.uuid() })
          .strict(),
        z
          .object({
            action: z.literal("register"),
            connection_id: z.uuid(),
            spreadsheet_id: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/),
          })
          .strict(),
        z
          .object({
            action: z.literal("map"),
            source_id: z.uuid(),
            sheet_id: z.number().int().nonnegative(),
            external_id: z.string().trim().min(1).max(200),
            id_column: z.string().trim().min(1).max(100),
            status_column: z.string().trim().min(1).max(100),
            project_id: z.uuid(),
            remote_values: statusValues,
            confirmed: z.literal(true),
          })
          .strict(),
        z.object({ action: z.literal("sync"), source_id: z.uuid() }).strict(),
        z
          .object({
            action: z.literal("mode"),
            source_id: z.uuid(),
            mode: z.enum(["import_only", "export_only", "two_way", "paused"]),
          })
          .strict(),
        z
          .object({
            action: z.literal("accept_sheet"),
            source_id: z.uuid(),
            mapping_id: z.uuid(),
            mapping_version: z.number().int().positive(),
            project_version: z.number().int().positive(),
            remote_value: z.string().max(100),
            confirmed: z.literal(true),
          })
          .strict(),
      ])
      .parse(await readJson(request));
    if (input.action === "probe")
      return NextResponse.json(
        await sheetsReadinessForUser(user.id, input.connection_id),
      );
    const db = integrationAdmin();
    if (input.action === "register") {
      const grid = await readSyncSheet(
        user.id,
        input.connection_id,
        input.spreadsheet_id,
      );
      const saved = await db
        .from("sheet_sync_sources")
        .insert({
          user_id: user.id,
          connection_id: input.connection_id,
          spreadsheet_id: input.spreadsheet_id,
          title: grid.properties.title,
        })
        .select("id")
        .single();
      dbError(saved.error);
      return NextResponse.json({
        source_id: saved.data!.id,
        worksheets: grid.sheets.map((s) => s.properties),
        read_only: true,
      });
    }
    if (input.action === "sync")
      return NextResponse.json(await syncSheetSource(user.id, input.source_id));
    if (input.action === "accept_sheet")
      return NextResponse.json(
        await syncSheetSource(user.id, input.source_id, {
          id: input.mapping_id,
          version: input.mapping_version,
          project_version: input.project_version,
          remote_value: input.remote_value,
        }),
      );
    if (input.action === "mode") {
      if (!["paused", "import_only"].includes(input.mode))
        throw new ApiError(
          409,
          "Outbound synchronization is not activated. The provider guard and separate write permission must first be verified on a test workbook.",
        );
      const r = await db
        .from("sheet_sync_sources")
        .update({ mode: input.mode })
        .eq("user_id", user.id)
        .eq("id", input.source_id)
        .select("id");
      dbError(r.error);
      if (!r.data?.length)
        throw new ApiError(404, "Owned spreadsheet connection not found.");
      return NextResponse.json({ ok: true });
    }
    const source = await db
      .from("sheet_sync_sources")
      .select("*")
      .eq("user_id", user.id)
      .eq("id", input.source_id)
      .single();
    dbError(source.error);
    const grid = await readSyncSheet(
      user.id,
      source.data!.connection_id,
      source.data!.spreadsheet_id,
      input.sheet_id,
    );
    const record = locateSheetRecord(
      grid,
      input.sheet_id,
      input.id_column,
      input.status_column,
      input.external_id,
      input.remote_values,
    );
    if (!record?.status || record.formula)
      throw new ApiError(
        409,
        "Choose a stable, literal source ID and an unprotected mapped status value. No source spreadsheet was changed.",
      );
    const project = await db
      .from("projects")
      .select("id,status,version")
      .eq("user_id", user.id)
      .eq("id", input.project_id)
      .single();
    dbError(project.error);
    const r = await db.from("sheet_sync_mappings").insert({
      user_id: user.id,
      source_id: input.source_id,
      sheet_id: input.sheet_id,
      external_id: input.external_id,
      id_column: input.id_column,
      status_column: input.status_column,
      project_id: input.project_id,
      remote_values: input.remote_values,
      baseline: record.status,
      remote_value: record.value,
      last_row: record.row,
      conflict:
        project.data!.status !== record.status
          ? {
              kind: "initial_difference",
              local: project.data!.status,
              base: record.status,
              remote: record.value,
              remote_status: record.status,
              project_version: project.data!.version,
            }
          : null,
    });
    dbError(r.error);
    return NextResponse.json({ ok: true, read_only: true });
  } catch (e) {
    return failure(e);
  }
}
