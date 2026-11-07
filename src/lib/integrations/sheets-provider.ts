import "server-only";
import { randomUUID } from "node:crypto";
import { boundedFileBody } from "../canvas/file-download";
import { gridSchema, type SheetGrid } from "./sheet-sync";
export class SheetProviderError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}
export type RevisionSnapshot = { grid: SheetGrid; revision: string };
async function mcpResult(
  token: string,
  method: "tools/call" | "tools/list",
  params: Record<string, unknown>,
  transport: typeof fetch = fetch,
) {
  const id = randomUUID();
  let response: Response;
  try {
    response = await transport("https://sheetsmcp.googleapis.com/mcp/v1", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      }),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new SheetProviderError(
      "UNKNOWN_OUTCOME",
      "Google did not confirm the request. The operation must be reconciled before retrying.",
      true,
    );
  }
  const raw = new TextDecoder().decode(
    await boundedFileBody(response, 2 * 1024 * 1024),
  );
  if (!response.ok) {
    if (response.status === 429)
      throw new SheetProviderError(
        "QUOTA",
        "Google Sheets quota is temporarily full.",
        true,
      );
    if (response.status === 403) {
      const reason = /SERVICE_DISABLED|has not been used|not enabled/i.test(raw)
        ? "API_DISABLED"
        : /agentic|AI-powered agent/i.test(raw)
          ? "CLIENT_CONFIGURATION"
          : /scope|permission/i.test(raw)
            ? "PERMISSION"
            : "ACCESS_REQUIRED";
      throw new SheetProviderError(
        reason,
        reason === "API_DISABLED"
          ? "Enable the Google Sheets MCP API in the existing Google Cloud project."
          : reason === "CLIENT_CONFIGURATION"
            ? "Google requires this OAuth client to be configured for its MCP service."
            : "Google Sheets MCP access or permission is not available to this connection.",
      );
    }
    if (response.status === 400 && /revision/i.test(raw))
      throw new SheetProviderError(
        "REVISION_CONFLICT",
        "The spreadsheet changed before the update. No stale write was accepted.",
      );
    throw new SheetProviderError(
      response.status >= 500 ? "UNKNOWN_OUTCOME" : "PROVIDER_REJECTED",
      "Google Sheets could not confirm this operation.",
      response.status >= 500,
    );
  }
  let envelope: Record<string, unknown>;
  try {
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      const messages = raw
        .split(/\r?\n\r?\n/)
        .map((block) =>
          block
            .split(/\r?\n/)
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim())
            .join("\n"),
        )
        .filter(Boolean)
        .map((x) => JSON.parse(x));
      envelope = messages.find((x) => x.id === id);
    } else envelope = JSON.parse(raw);
    if (!envelope || envelope.id !== id) throw Error();
  } catch {
    throw new SheetProviderError(
      "PROTOCOL",
      "Google returned an unsupported MCP response.",
    );
  }
  const result = envelope.result as
    | {
        isError?: boolean;
        structuredContent?: unknown;
        content?: { type: string; text?: string }[];
      }
    | undefined;
  if (envelope.error || result?.isError) {
    const detail = JSON.stringify(envelope.error ?? result);
    if (/revision/i.test(detail))
      throw new SheetProviderError(
        "REVISION_CONFLICT",
        "The spreadsheet revision changed.",
      );
    if (/agentic|AI-powered agent/i.test(detail))
      throw new SheetProviderError(
        "CLIENT_CONFIGURATION",
        "Google requires this OAuth client to be configured for its MCP service.",
      );
    if (/developer preview|allowlist|enroll|preview program/i.test(detail))
      throw new SheetProviderError(
        "PREVIEW_ACCESS_REQUIRED",
        "Google Sheets MCP preview access is required for this account.",
      );
    if (
      /invalid.*(?:argument|param)|required.*(?:field|property)|missing.*(?:field|property)|unknown.*field|validation|schema/i.test(
        detail,
      )
    )
      throw new SheetProviderError(
        "TOOL_INPUT_INVALID",
        "Google rejected the MCP input schema. Check the advertised tool parameters.",
      );
    throw new SheetProviderError(
      "PROVIDER_REJECTED",
      "Google rejected the bounded spreadsheet operation.",
    );
  }
  if (!result || typeof result !== "object")
    throw new SheetProviderError("PROTOCOL", "Google returned no MCP result.");
  return result;
}
export async function sheetsMcp(
  token: string,
  name: "get_spreadsheet" | "update_spreadsheet",
  args: Record<string, unknown>,
  transport: typeof fetch = fetch,
) {
  const result = await mcpResult(
    token,
    "tools/call",
    { name, arguments: args },
    transport,
  );
  let data = result?.structuredContent;
  if (!data) {
    try {
      const blocks = result?.content?.filter((c) => c.type === "text") ?? [];
      if (blocks.length !== 1) throw Error();
      data = JSON.parse(blocks[0].text!);
    } catch {
      throw new SheetProviderError(
        "PROTOCOL",
        "The spreadsheet response could not be validated.",
      );
    }
  }
  if (!data || typeof data !== "object")
    throw new SheetProviderError(
      "PROTOCOL",
      "The spreadsheet response is missing.",
    );
  return (
    (data as { content?: Record<string, unknown> }).content ??
    (data as Record<string, unknown>)
  );
}
/** Read-only discovery. Only fixed tool and field names are exposed, never provider content. */
export async function sheetsCapabilities(
  token: string,
  transport: typeof fetch = fetch,
) {
  const result = (await mcpResult(token, "tools/list", {}, transport)) as {
    tools?: {
      name?: unknown;
      inputSchema?: {
        properties?: Record<string, unknown>;
        required?: unknown;
      };
    }[];
  };
  if (!Array.isArray(result.tools) || result.tools.length > 100)
    throw new SheetProviderError(
      "PROTOCOL",
      "Google did not return a bounded tool list.",
    );
  return result.tools
    .filter((t) =>
      ["get_spreadsheet", "update_spreadsheet", "create_spreadsheet"].includes(
        String(t.name),
      ),
    )
    .map((t) => ({
      name: String(t.name),
      fields: Object.keys(t.inputSchema?.properties ?? {})
        .filter((k) => /^[a-zA-Z_][a-zA-Z0-9_]{0,99}$/.test(k))
        .slice(0, 30),
      required: Array.isArray(t.inputSchema?.required)
        ? t.inputSchema.required
            .filter(
              (k): k is string =>
                typeof k === "string" &&
                /^[a-zA-Z_][a-zA-Z0-9_]{0,99}$/.test(k),
            )
            .slice(0, 30)
        : [],
    }));
}
export async function readRevisionSheet(
  token: string,
  id: string,
  ranges: string[],
  transport: typeof fetch = fetch,
  argumentStyle: "camel" | "snake" = "camel",
): Promise<RevisionSnapshot> {
  if (
    !/^[A-Za-z0-9_-]{10,200}$/.test(id) ||
    ranges.length > 3 ||
    ranges.some((x) => x.length > 200)
  )
    throw new SheetProviderError("INPUT", "Invalid bounded spreadsheet read.");
  const data = await sheetsMcp(
    token,
    "get_spreadsheet",
    argumentStyle === "snake"
      ? { spreadsheet_id: id, include_grid_data: true, ranges }
      : { spreadsheetId: id, includeGridData: true, ranges },
    transport,
  );
  const grid = gridSchema.parse(data);
  if (grid.spreadsheetId !== id)
    throw new SheetProviderError("IDENTITY", "Spreadsheet identity mismatch.");
  const revision =
    data.revisionId ??
    (data.writeControl as { requiredRevisionId?: unknown } | undefined)
      ?.requiredRevisionId;
  if (typeof revision !== "string" || !revision || revision.length > 500)
    throw new SheetProviderError(
      "REVISION_UNAVAILABLE",
      "Google did not provide a usable spreadsheet revision. Outbound writes cannot be enabled.",
    );
  return { grid, revision };
}
export async function writeRevisionCell(
  token: string,
  input: {
    spreadsheet: string;
    revision: string;
    sheet: number;
    row: number;
    column: number;
    value: string;
  },
  transport: typeof fetch = fetch,
) {
  if (
    !input.revision ||
    input.revision.length > 500 ||
    !/^[A-Za-z0-9_-]{10,200}$/.test(input.spreadsheet) ||
    ![input.sheet, input.row, input.column].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
    input.value.length > 100
  )
    throw new SheetProviderError("INPUT", "Invalid bounded spreadsheet write.");
  const result = await sheetsMcp(
    token,
    "update_spreadsheet",
    {
      spreadsheetId: input.spreadsheet,
      writeControl: { requiredRevisionId: input.revision },
      requests: [
        {
          updateCells: {
            range: {
              sheetId: input.sheet,
              startRowIndex: input.row,
              endRowIndex: input.row + 1,
              startColumnIndex: input.column,
              endColumnIndex: input.column + 1,
            },
            rows: [
              { values: [{ userEnteredValue: { stringValue: input.value } }] },
            ],
            fields: "userEnteredValue",
          },
        },
      ],
    },
    transport,
  );
  if (
    result.spreadsheetId !== input.spreadsheet ||
    !Array.isArray(result.replies) ||
    result.replies.length !== 1
  )
    throw new SheetProviderError(
      "UNKNOWN_OUTCOME",
      "Google did not return a verifiable write acknowledgement.",
      true,
    );
  return { acknowledged: true };
}
