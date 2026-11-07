import { it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  readRevisionSheet,
  writeRevisionCell,
  sheetsMcp,
} from "../src/lib/integrations/sheets-provider";
const id = "syntheticSpreadsheet001";
const response = (body: unknown) =>
  Response.json({
    jsonrpc: "2.0",
    id: (body as { id: string }).id,
    result: {
      structuredContent: {
        content: {
          spreadsheetId: id,
          properties: { title: "[TEST]" },
          sheets: [],
          revisionId: "r1",
        },
      },
    },
  });
it("requires a usable provider revision instead of treating a normal sheet read as safe write support", async () => {
  const t = vi.fn(async (_u, init) => response(JSON.parse(String(init?.body))));
  expect(
    (await readRevisionSheet("synthetic", id, ["'Test'!A1:C5"], t)).revision,
  ).toBe("r1");
  const missing = vi.fn(async (_u, init) => {
    const b = JSON.parse(String(init?.body));
    return Response.json({
      jsonrpc: "2.0",
      id: b.id,
      result: {
        structuredContent: {
          content: {
            spreadsheetId: id,
            properties: { title: "[TEST]" },
            sheets: [],
          },
        },
      },
    });
  });
  await expect(
    readRevisionSheet("synthetic", id, ["'Test'!A1:C5"], missing),
  ).rejects.toMatchObject({ code: "REVISION_UNAVAILABLE" });
});
it("sends exactly one literal cell update with a mandatory provider revision", async () => {
  const t = vi.fn(async (_u, init) => {
    const b = JSON.parse(String(init?.body));
    expect(b.params.arguments.writeControl).toEqual({
      requiredRevisionId: "r1",
    });
    expect(b.params.arguments.requests).toEqual([
      {
        updateCells: {
          range: {
            sheetId: 7,
            startRowIndex: 2,
            endRowIndex: 3,
            startColumnIndex: 9,
            endColumnIndex: 10,
          },
          rows: [
            { values: [{ userEnteredValue: { stringValue: "Complete" } }] },
          ],
          fields: "userEnteredValue",
        },
      },
    ]);
    return Response.json({
      id: b.id,
      result: {
        structuredContent: { content: { spreadsheetId: id, replies: [{}] } },
      },
    });
  });
  await expect(
    writeRevisionCell(
      "synthetic",
      {
        spreadsheet: id,
        revision: "r1",
        sheet: 7,
        row: 2,
        column: 9,
        value: "Complete",
      },
      t,
    ),
  ).resolves.toEqual({ acknowledged: true });
  await expect(
    writeRevisionCell(
      "synthetic",
      {
        spreadsheet: id,
        revision: "",
        sheet: 7,
        row: 2,
        column: 9,
        value: "Complete",
      },
      t,
    ),
  ).rejects.toMatchObject({ code: "INPUT" });
  expect(t).toHaveBeenCalledTimes(1);
});
it("classifies provider restrictions, stale revisions and unknown outcomes without exposing raw provider data", async () => {
  await expect(
    sheetsMcp(
      "synthetic",
      "get_spreadsheet",
      {},
      vi.fn(
        async () =>
          new Response("SERVICE_DISABLED sensitive-provider-body", {
            status: 403,
          }),
      ),
    ),
  ).rejects.toMatchObject({ code: "API_DISABLED" });
  await expect(
    sheetsMcp(
      "synthetic",
      "update_spreadsheet",
      {},
      vi.fn(async () => new Response("revision mismatch", { status: 400 })),
    ),
  ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  await expect(
    sheetsMcp(
      "synthetic",
      "update_spreadsheet",
      {},
      vi.fn(async () => {
        throw Error("secret");
      }),
    ),
  ).rejects.toMatchObject({
    code: "UNKNOWN_OUTCOME",
    message: expect.not.stringContaining("secret"),
  });
});
it("accepts a bounded SSE result and rejects another request identity", async () => {
  const t = vi.fn(async (_u, init) => {
    const b = JSON.parse(String(init?.body));
    return new Response(
      "event: message\ndata: " +
        JSON.stringify({
          id: b.id,
          result: {
            content: [
              { type: "text", text: JSON.stringify({ content: { ok: true } }) },
            ],
          },
        }) +
        "\n\n",
      { headers: { "Content-Type": "text/event-stream" } },
    );
  });
  expect(await sheetsMcp("synthetic", "get_spreadsheet", {}, t)).toEqual({
    ok: true,
  });
  await expect(
    sheetsMcp(
      "synthetic",
      "get_spreadsheet",
      {},
      vi.fn(async () => Response.json({ id: "wrong", result: {} })),
    ),
  ).rejects.toMatchObject({ code: "PROTOCOL" });
});
