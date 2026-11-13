import "server-only";
import { z } from "zod";
import { boundedFileBody } from "../canvas/file-download";
export class SheetsRestError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
    public retryAfterSeconds = 60,
  ) {
    super(message);
  }
}
const sheetId = z.string().regex(/^[A-Za-z0-9_-]{10,200}$/);
export const restMetadata = z.object({
  spreadsheetId: sheetId,
  properties: z.object({ title: z.string(), timeZone: z.string().optional() }),
  sheets: z
    .array(
      z.object({
        properties: z.object({
          sheetId: z.number().int(),
          title: z.string(),
          gridProperties: z.object({
            rowCount: z.number().int(),
            columnCount: z.number().int(),
          }),
        }),
      }),
    )
    .max(200),
});
/** Fixed Google host, no redirects or secrets in exceptions. Writes are never blindly retried. */
export async function sheetsRestRequest(
  token: string,
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
    query?: URLSearchParams;
    write?: boolean;
  } = {},
  transport: typeof fetch = fetch,
): Promise<unknown> {
  if (
    !/^\/v4\/spreadsheets(?:\/[A-Za-z0-9_-]+(?:\/values(?::batchUpdate|:batchClear)?)?)?(?::batchUpdate)?$/.test(
      path,
    )
  )
    throw new SheetsRestError("INPUT", "Unsupported spreadsheet endpoint.");
  const url = new URL(path, "https://sheets.googleapis.com");
  if (options.query) url.search = options.query.toString();
  let response: Response;
  try {
    response = await transport(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new SheetsRestError(
      options.write ? "UNKNOWN_OUTCOME" : "UNAVAILABLE",
      options.write
        ? "Google did not confirm the write. Reconcile it before retrying."
        : "Google Sheets could not be reached.",
      !options.write,
    );
  }
  if (!response.ok) {
    // Do not retain or return provider bodies: they can contain private cell data.
    try {
      await response.body?.cancel();
    } catch {}
    if (response.status === 401)
      throw new SheetsRestError(
        "AUTH_REQUIRED",
        "Reconnect this Google account.",
      );
    if (response.status === 403)
      throw new SheetsRestError(
        "PERMISSION",
        "Google denied access. Check the granted Sheets scope, API configuration and workbook sharing.",
      );
    if (response.status === 404)
      throw new SheetsRestError(
        "NOT_FOUND",
        "This spreadsheet is unavailable. Check access and its source identity.",
      );
    if (response.status === 429) {
      const n = Number(response.headers.get("retry-after"));
      throw new SheetsRestError(
        "RATE_LIMIT",
        "Google Sheets quota is temporarily full.",
        true,
        Number.isFinite(n) && n > 0 ? Math.min(3600, Math.ceil(n)) : 60,
      );
    }
    if (response.status >= 500)
      throw new SheetsRestError(
        options.write ? "UNKNOWN_OUTCOME" : "UNAVAILABLE",
        options.write
          ? "Google did not confirm the write. Reconcile it before retrying."
          : "Google Sheets is temporarily unavailable.",
        !options.write,
      );
    throw new SheetsRestError(
      "REJECTED",
      "Google rejected the spreadsheet request. Review the mapped range and permitted values.",
    );
  }
  try {
    return JSON.parse(
      new TextDecoder().decode(
        await boundedFileBody(response, 4 * 1024 * 1024),
      ),
    );
  } catch {
    throw new SheetsRestError(
      options.write ? "UNKNOWN_OUTCOME" : "INVALID_RESPONSE",
      options.write
        ? "Google returned an unverifiable write response. Reconcile before retrying."
        : "Google returned an unsupported or oversized spreadsheet response.",
    );
  }
}
export async function readRestMetadata(
  token: string,
  id: string,
  transport: typeof fetch = fetch,
) {
  sheetId.parse(id);
  const data = restMetadata.parse(
    await sheetsRestRequest(
      token,
      `/v4/spreadsheets/${id}`,
      {
        query: new URLSearchParams({
          fields:
            "spreadsheetId,properties(title,timeZone),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))",
        }),
      },
      transport,
    ),
  );
  if (data.spreadsheetId !== id)
    throw new SheetsRestError("IDENTITY", "Spreadsheet identity mismatch.");
  return data;
}
export function columnName(index: number) {
  if (!Number.isInteger(index) || index < 0 || index > 16383)
    throw new SheetsRestError("INPUT", "Invalid source column.");
  let n = index + 1,
    s = "";
  while (n) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}
export function a1Range(
  title: string,
  row: number,
  column: number,
  endRow = row + 1,
  endColumn = column + 1,
) {
  if (
    ![row, column, endRow, endColumn].every(Number.isSafeInteger) ||
    row < 0 ||
    column < 0 ||
    endRow <= row ||
    endColumn <= column
  )
    throw new SheetsRestError("INPUT", "Invalid bounded source range.");
  return `'${title.replaceAll("'", "''")}'!${columnName(column)}${row + 1}:${columnName(endColumn - 1)}${endRow}`;
}
export async function readRestCells(
  token: string,
  id: string,
  worksheet: number,
  range: {
    header_row: number;
    end_row: number;
    start_column: number;
    end_column: number;
  },
  transport: typeof fetch = fetch,
) {
  const meta = await readRestMetadata(token, id, transport);
  const sheet = meta.sheets.find((s) => s.properties.sheetId === worksheet);
  if (!sheet)
    throw new SheetsRestError(
      "SOURCE_CHANGED",
      "The mapped worksheet is missing.",
    );
  if (
    (range.end_row - range.header_row) *
      (range.end_column - range.start_column) >
    30000
  )
    throw new SheetsRestError(
      "INPUT",
      "Choose a source range of at most 30,000 cells.",
    );
  const a1 = a1Range(
    sheet.properties.title,
    range.header_row,
    range.start_column,
    range.end_row,
    range.end_column,
  );
  const data = await sheetsRestRequest(
    token,
    `/v4/spreadsheets/${id}`,
    {
      query: new URLSearchParams({
        ranges: a1,
        includeGridData: "true",
        fields:
          "spreadsheetId,properties(title),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)),protectedRanges(range,unprotectedRanges,warningOnly),data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue,formattedValue,userEnteredFormat,dataValidation))))",
      }),
    },
    transport,
  );
  return { metadata: meta, grid: data, range: a1 };
}
export async function writeRestCells(
  token: string,
  id: string,
  changes: { range: string; value: string | number | boolean | null }[],
  transport: typeof fetch = fetch,
) {
  sheetId.parse(id);
  if (
    !changes.length ||
    changes.length > 100 ||
    changes.some(
      (c) =>
        c.range.length > 400 || !/^'.+'![A-Z]+\d+:[A-Z]+\d+$/.test(c.range),
    )
  )
    throw new SheetsRestError("INPUT", "Invalid bounded cell update.");
  const body = {
    valueInputOption: "RAW",
    includeValuesInResponse: true,
    data: changes.map((c) => ({
      range: c.range,
      majorDimension: "ROWS",
      values: [[c.value ?? ""]],
    })),
  };
  const response = await sheetsRestRequest(
    token,
    `/v4/spreadsheets/${id}/values:batchUpdate`,
    { method: "POST", write: true, body },
    transport,
  );
  const ack = z
    .object({ spreadsheetId: z.string(), totalUpdatedCells: z.number().int() })
    .safeParse(response);
  if (!ack.success)
    throw new SheetsRestError(
      "UNKNOWN_OUTCOME",
      "Google returned an unverifiable write acknowledgement. Reconcile before retrying.",
    );
  const result = ack.data;
  if (
    result.spreadsheetId !== id ||
    result.totalUpdatedCells !== changes.length
  )
    throw new SheetsRestError(
      "UNKNOWN_OUTCOME",
      "Google did not confirm every targeted cell. Reconcile before retrying.",
    );
  return { provider_accepted: true, cells: changes.length };
}
/** Only called after a durable creation intent is saved. An unknown outcome must not auto-create another file. */
export async function createRestTestWorkbook(
  token: string,
  operation: string,
  transport: typeof fetch = fetch,
) {
  z.uuid().parse(operation);
  const result = z
    .object({ spreadsheetId: sheetId, spreadsheetUrl: z.url() })
    .parse(
      await sheetsRestRequest(
        token,
        "/v4/spreadsheets",
        {
          method: "POST",
          write: true,
          body: {
            properties: { title: `[TEST] Life OS Sheets Sync ${operation}` },
            sheets: [
              {
                properties: {
                  sheetId: 0,
                  title: "Sync Test",
                  gridProperties: { rowCount: 50, columnCount: 8 },
                },
                data: [
                  {
                    startRow: 0,
                    startColumn: 0,
                    rowData: [
                      {
                        values: [
                          { userEnteredValue: { stringValue: "Record ID" } },
                          { userEnteredValue: { stringValue: "Player" } },
                          { userEnteredValue: { stringValue: "Made" } },
                          { userEnteredValue: { stringValue: "Attempted" } },
                          { userEnteredValue: { stringValue: "Accuracy" } },
                          { userEnteredValue: { stringValue: "Unrelated" } },
                        ],
                      },
                      {
                        values: [
                          {
                            userEnteredValue: { stringValue: "test-player-1" },
                          },
                          {
                            userEnteredValue: {
                              stringValue: "[TEST] Player One",
                            },
                          },
                          { userEnteredValue: { numberValue: 4 } },
                          { userEnteredValue: { numberValue: 10 } },
                          {
                            userEnteredValue: {
                              formulaValue: "=IFERROR(C2/D2,0)",
                            },
                            userEnteredFormat: {
                              numberFormat: {
                                type: "PERCENT",
                                pattern: "0.0%",
                              },
                              backgroundColor: {
                                red: 0.9,
                                green: 0.95,
                                blue: 1,
                              },
                            },
                          },
                          {
                            userEnteredValue: {
                              stringValue: "[TEST] Preserve this cell",
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
        transport,
      ),
    );
  if (
    !result.spreadsheetUrl.startsWith(
      `https://docs.google.com/spreadsheets/d/${result.spreadsheetId}/`,
    )
  )
    throw new SheetsRestError(
      "UNKNOWN_OUTCOME",
      "The test workbook response could not be verified.",
    );
  return result;
}
