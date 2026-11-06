import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/auth";
import { connectionAccess } from "./google-server";
import { SHEETS_READ_SCOPE } from "./google-oauth";
export const CAREER_SHEET_ID = "1xDTpBdZ4FGXdTIcquq_pFXfTxdUy84xOD8vpgRAtgZc";
export async function sheetRead(
  path: string,
  token: string,
  params: Record<string, string> = {},
) {
  if (!path.startsWith("/v4/spreadsheets/" + CAREER_SHEET_ID))
    throw Error("Unconfigured spreadsheet");
  const url = new URL("https://sheets.googleapis.com" + path);
  url.search = new URLSearchParams(params).toString();
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new ApiError(
      502,
      response.status === 403
        ? "Enable the Google Sheets API and reconnect with read-only spreadsheet permission."
        : "The career spreadsheet could not be read. Check access and try again.",
      "SHEETS_READ_FAILED",
    );
  return response.json();
}
const metadataSchema = z.object({
  spreadsheetId: z.literal(CAREER_SHEET_ID),
  properties: z.object({ title: z.string() }),
  sheets: z.array(
    z.object({
      properties: z.object({
        sheetId: z.number(),
        title: z.string(),
        gridProperties: z.object({
          rowCount: z.number(),
          columnCount: z.number(),
        }),
      }),
    }),
  ),
});
export type SheetSnapshot = {
  id: string;
  title: string;
  tabs: {
    id: number;
    title: string;
    values: (string | number | boolean | null)[][];
  }[];
  fingerprint: string;
};
export async function readCareerSheet(
  connectionId: string,
): Promise<SheetSnapshot> {
  const { token, scope } = await connectionAccess(connectionId);
  if (!scope.split(" ").includes(SHEETS_READ_SCOPE))
    throw new ApiError(
      409,
      "Connect the career spreadsheet to grant its separate read-only permission.",
      "SHEETS_PERMISSION_REQUIRED",
    );
  const meta = metadataSchema.parse(
    await sheetRead("/v4/spreadsheets/" + CAREER_SHEET_ID, token, {
      fields:
        "spreadsheetId,properties(title),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))",
    }),
  );
  const tabs = [];
  for (const { properties: t } of meta.sheets) {
    if (t.gridProperties.rowCount > 2000 || t.gridProperties.columnCount > 26)
      throw new ApiError(
        422,
        "A source tab exceeds the verified import limit. Review its range before importing.",
      );
    const range = `'${t.title.replaceAll("'", "''")}'!A1:${String.fromCharCode(65 + Math.min(t.gridProperties.columnCount, 26) - 1)}${t.gridProperties.rowCount}`;
    const response = z
      .object({
        values: z
          .array(
            z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
          )
          .default([]),
      })
      .parse(
        await sheetRead(
          `/v4/spreadsheets/${CAREER_SHEET_ID}/values/${encodeURIComponent(range)}`,
          token,
          { valueRenderOption: "FORMATTED_VALUE" },
        ),
      );
    tabs.push({ id: t.sheetId, title: t.title, values: response.values });
  }
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(tabs))
    .digest("hex");
  return {
    id: meta.spreadsheetId,
    title: meta.properties.title,
    tabs,
    fingerprint,
  };
}
