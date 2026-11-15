import { NextResponse } from "next/server";
import { authorized } from "@/lib/auth";
import { checkMutation, dbError, failure, readJson } from "@/lib/http";
import { z } from "zod";
import {
  readDataset,
  ownedDataset,
} from "@/lib/integrations/sheet-rest-server";
import { sheetSyncDiagnostic } from "@/lib/integrations/sheet-sync-diagnostic";
export const maxDuration = 60;
/** Read-only provider probe, using the owner's existing server-side credentials. Never triggers outbound sync. */
export async function POST(request: Request) {
  try {
    checkMutation(request);
    z.object({})
      .strict()
      .parse(await readJson(request));
    const { db, user } = await authorized();
    const sources = await db
      .from("sheet_rest_datasets")
      .select("id,mode")
      .eq("user_id", user.id)
      .eq("test_only", false)
      .order("created_at")
      .limit(20);
    dbError(sources.error);
    const source = sources.data?.find((s) => s.mode !== "paused");
    if (!source)
      return NextResponse.json({
        status: "not_configured",
        message: "No active Google Sheets source is configured.",
      });
    try {
      await readDataset(await ownedDataset(user.id, source.id));
      return NextResponse.json(
        {
          status: "readable",
          message:
            "Life OS can read Google Sheets. The connection is working; any saved sync failure still needs review. No spreadsheet cells were changed.",
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    } catch (error) {
      const diagnostic = sheetSyncDiagnostic(error);
      return NextResponse.json(
        { status: "needs_attention", ...diagnostic },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
  } catch (e) {
    return failure(e);
  }
}
