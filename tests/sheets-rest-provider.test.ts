import { it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  sheetsRestRequest,
  readRestMetadata,
  writeRestCells,
  columnName,
  a1Range,
  createRestTestWorkbook,
} from "../src/lib/integrations/sheets-rest-provider";
const id = "syntheticSpreadsheet001";
it("reads metadata from the fixed REST host and rejects another spreadsheet identity", async () => {
  const t = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(new URL(String(input)).hostname).toBe("sheets.googleapis.com");
    expect(init?.redirect).toBe("error");
    return Response.json({
      spreadsheetId: id,
      properties: { title: "[TEST]" },
      sheets: [],
    });
  });
  expect((await readRestMetadata("synthetic", id, t)).spreadsheetId).toBe(id);
  await expect(
    readRestMetadata(
      "synthetic",
      id,
      vi.fn(async () =>
        Response.json({
          spreadsheetId: "differentSheet001",
          properties: { title: "[TEST]" },
          sheets: [],
        }),
      ),
    ),
  ).rejects.toMatchObject({ code: "IDENTITY" });
});
it("writes only explicitly targeted literal values without claiming conditional updates", async () => {
  const t = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`,
    );
    const b = JSON.parse(String(init?.body));
    expect(b.valueInputOption).toBe("RAW");
    expect(b.data).toEqual([
      { range: "'Test'!C2:C2", majorDimension: "ROWS", values: [[5]] },
      { range: "'Test'!D2:D2", majorDimension: "ROWS", values: [[12]] },
    ]);
    expect(b).not.toHaveProperty("writeControl");
    expect(init?.headers).not.toHaveProperty("If-Match");
    return Response.json({ spreadsheetId: id, totalUpdatedCells: 2 });
  });
  expect(
    await writeRestCells(
      "synthetic",
      id,
      [
        { range: "'Test'!C2:C2", value: 5 },
        { range: "'Test'!D2:D2", value: 12 },
      ],
      t,
    ),
  ).toEqual({ provider_accepted: true, cells: 2 });
});
it("does not retry unknown write outcomes and keeps provider error details private", async () => {
  const t = vi.fn(async () => {
    throw Error("private provider details");
  });
  await expect(
    writeRestCells("synthetic", id, [{ range: "'Test'!C2:C2", value: 5 }], t),
  ).rejects.toMatchObject({
    code: "UNKNOWN_OUTCOME",
    retryable: false,
    message: expect.not.stringContaining("private"),
  });
  expect(t).toHaveBeenCalledTimes(1);
  for (const status of [401, 403, 429, 503]) {
    const expected = {
      401: "AUTH_REQUIRED",
      403: "PERMISSION",
      429: "RATE_LIMIT",
      503: "UNKNOWN_OUTCOME",
    }[status];
    await expect(
      sheetsRestRequest(
        "synthetic",
        `/v4/spreadsheets/${id}`,
        { method: "POST", write: true },
        vi.fn(
          async () =>
            new Response("private value", {
              status,
              headers: { "Retry-After": "90" },
            }),
        ),
      ),
    ).rejects.toMatchObject({
      code: expected,
      message: expect.not.stringContaining("private"),
    });
  }
});
it("keeps unverifiable successful write responses uncertain", async () => {
  await expect(
    writeRestCells(
      "synthetic",
      id,
      [{ range: "'Test'!C2:C2", value: 5 }],
      vi.fn(async () => Response.json({ unexpected: true })),
    ),
  ).rejects.toMatchObject({ code: "UNKNOWN_OUTCOME" });
  await expect(
    writeRestCells(
      "synthetic",
      id,
      [{ range: "'Test'!C2:C2", value: 5 }],
      vi.fn(async () =>
        Response.json({ spreadsheetId: id, totalUpdatedCells: 0 }),
      ),
    ),
  ).rejects.toMatchObject({ code: "UNKNOWN_OUTCOME" });
});
it("quotes worksheet names and supports columns beyond Z without guessing row identities", () => {
  expect(columnName(26)).toBe("AA");
  expect(columnName(16383)).toBe("XFD");
  expect(a1Range("Player's report", 1, 26)).toBe("'Player''s report'!AA2:AA2");
  expect(() => a1Range("Test", -1, 0)).toThrow();
});
it("creates a clearly synthetic workbook with preserved formula and formatting fixtures", async () => {
  const operation = "11111111-1111-4111-8111-111111111111";
  const t = vi.fn(async (_input, init) => {
    const b = JSON.parse(String(init?.body));
    expect(b.properties.title).toContain("[TEST] Life OS Sheets Sync");
    const row = b.sheets[0].data[0].rowData[1].values;
    expect(row[4].userEnteredValue.formulaValue).toBe("=IFERROR(C2/D2,0)");
    expect(row[4].userEnteredFormat.numberFormat.type).toBe("PERCENT");
    expect(row[5].userEnteredValue.stringValue).toContain("Preserve");
    return Response.json({
      spreadsheetId: id,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`,
    });
  });
  expect(
    (await createRestTestWorkbook("synthetic", operation, t)).spreadsheetId,
  ).toBe(id);
});
