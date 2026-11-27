import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, dbError, failure, readJson } from "@/lib/http";
import { readCareerSheet } from "@/lib/integrations/sheets-server";
import { importWorkbook } from "@/lib/career/import-server";
import { sheetsDisabled } from "@/lib/career/sheets-switch";
import type { Workbook } from "@/lib/career/workbook";

export const maxDuration = 120;

const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const input = z
  .object({
    /** Default true: report what would change, write nothing. */
    dry_run: z.boolean().default(true),
    /**
     * A saved copy of the workbook instead of reading Google. Only accepted
     * where LIFE_OS_ALLOW_SNAPSHOT_IMPORT is set (the isolated test setup).
     */
    snapshot: z
      .object({
        tabs: z
          .array(
            z.object({
              id: z.number(),
              title: z.string().max(200),
              values: z.array(z.array(cell)).max(2000),
            }),
          )
          .max(20),
      })
      .optional(),
  })
  .strict();

/**
 * Imports the Google Sheets career dashboard into Life OS. Re-runnable and
 * read-only toward Google: the workbook itself is never changed.
 */
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { db, user } = await authorized();
    const x = input.parse(await readJson(request, 4_000_000));
    let wb: Workbook;
    if (x.snapshot) {
      if (process.env.LIFE_OS_ALLOW_SNAPSHOT_IMPORT !== "1")
        throw new ApiError(403, "Imports read the workbook from Google.");
      wb = x.snapshot;
    } else {
      if (sheetsDisabled())
        throw new ApiError(
          503,
          "Google Sheets is turned off. Your Life OS records are unaffected.",
          "SHEETS_DISABLED",
        );
      const conns = await db
        .from("calendar_connections")
        .select("id,status")
        .eq("user_id", user.id)
        .eq("status", "connected");
      dbError(conns.error);
      let read: Workbook | null = null;
      let last: unknown = null;
      for (const c of conns.data ?? []) {
        try {
          read = await readCareerSheet(c.id);
          break;
        } catch (e) {
          last = e;
        }
      }
      if (!read)
        throw last instanceof ApiError
          ? last
          : new ApiError(
              409,
              "Connect Google with Sheets access to import the workbook.",
            );
      wb = read;
    }
    return NextResponse.json(
      await importWorkbook(db, user.id, wb, { dryRun: x.dry_run }),
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (e) {
    return failure(e);
  }
}
