"use client";
import { stamp } from "@/lib/display";
import {
  syncAllTables,
  type BatchResult,
  type SyncResult,
} from "@/lib/integrations/sheet-sync-batch";
import { availableProject } from "@/lib/visible-areas";
import { useEffect, useState, useRef } from "react";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import { calendarRequest } from "./use-calendar";
import {
  datasetConfig,
  type DatasetConfig,
  type Values,
  type Cells,
  type Conflicts,
} from "@/lib/integrations/sheet-ledger-model";
export type Dataset = {
  id: string;
  title: string;
  worksheet_title: string;
  spreadsheet_id: string;
  mode: string;
  outbound_enabled: boolean;
  automatic_outbound: boolean;
  test_only: boolean;
  version: number;
  config: DatasetConfig;
  last_read_at: string | null;
  last_write_at: string | null;
  last_error: string | null;
};
export type Row = {
  id: string;
  version: number;
  local_values: Values;
  remote_cells: Cells;
  baseline: Cells;
  conflicts: Conflicts;
  state: string;
  row_locator: number;
};
type Operation = {
  id: string;
  row_id: string;
  version: number;
  operation_type: string;
  status: string;
  intended: Values;
  last_error: string | null;
};
type State = {
  datasets: Dataset[];
  rows?: Row[];
  next?: string | null;
  operations?: Operation[];
  more_operations?: boolean;
  change_log?: {
    id: string;
    operation_type: string;
    intended: Values;
    verified_at: string | null;
  }[];
  tests: {
    id: string;
    spreadsheet_url: string;
    status: string;
    results: Record<string, boolean>;
    last_error: string | null;
  }[];
  runs?: {
    id: string;
    status: string;
    started_at: string;
    summary: Record<string, number | boolean>;
  }[];
};
type Metadata = {
  properties: { title: string };
  sheets: {
    properties: {
      sheetId: number;
      title: string;
      gridProperties: { rowCount: number; columnCount: number };
    };
  }[];
};
const endpoint = "/api/v1/sheets/tables";
const nextWeekDay = () =>
  new Date(new Date().getTime() + 7 * 86400000).toLocaleDateString("en-CA");
export function SheetRestPanel() {
  const { data: workspace, refresh } = useWorkspace();
  const [state, setState] = useState<State | null>(null),
    [selected, setSelected] = useState(""),
    [connections, setConnections] = useState<{ id: string }[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [meta, setMeta] = useState<Metadata | null>(null),
    [spreadsheet, setSpreadsheet] = useState(""),
    [connection, setConnection] = useState(""),
    [testRequest, setTestRequest] = useState("");
  const [batchRunning, setBatchRunning] = useState(false);
  const [batch, setBatch] = useState<BatchResult[]>([]);
  const batchController = useRef<AbortController | null>(null);
  useEffect(() => () => batchController.current?.abort(), []);
  const d = state?.datasets.find((d) => d.id === selected);
  async function load(id = selected, after?: string) {
    const s = await calendarRequest<State>(
      endpoint +
        (id ? "?dataset=" + id + (after ? "&after=" + after : "") : ""),
    );
    setState((old) =>
      after ? { ...s, rows: [...(old?.rows ?? []), ...(s.rows ?? [])] } : s,
    );
  }
  useEffect(() => {
    let live = true;
    void Promise.all([
      calendarRequest<State>(endpoint),
      calendarRequest<{ connections: { id: string; status: string }[] }>(
        "/api/v1/calendar/connections",
      ),
    ])
      .then(([s, c]) => {
        if (live) {
          setState(s);
          setConnections(c.connections.filter((x) => x.status === "connected"));
          setConnection(
            c.connections.find((x) => x.status === "connected")?.id ?? "",
          );
        }
      })
      .catch(() => {
        if (live) setError("Sheets settings could not be loaded.");
      });
    return () => {
      live = false;
    };
  }, []);
  const requests = useRef(new Map<string, string>());
  async function act(input: unknown) {
    const body = input as Record<string, unknown>;
    const intent = JSON.stringify({ ...body, request_id: undefined });
    if (body.request_id) {
      if (!requests.current.has(intent))
        requests.current.set(intent, String(body.request_id));
      body.request_id = requests.current.get(intent);
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await calendarRequest<Record<string, unknown>>(endpoint, {
        method: "POST",
        body: JSON.stringify(input),
      });
      requests.current.delete(intent);
      await load();
      await refresh();
      window.dispatchEvent(new Event("lifeos:changed"));
      setNotice(
        body.action === "sync"
          ? result.conflicts || result.held_outbound
            ? "Updated. Some changes are pending or need review."
            : "Table synced."
          : "Changes saved.",
      );
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sheets operation failed.");
    } finally {
      setBusy(false);
    }
  }
  async function buildReview(datasetId: string) {
    const result = await act({
      action: "weekly_review",
      dataset_id: datasetId,
      day: nextWeekDay(),
    });
    if (!result) return;
    if (result.unchanged) {
      setNotice(
        "Nothing to add yet: Life OS has no new grades or tasks for next week.",
      );
      return;
    }
    await act({ action: "sync", dataset_id: datasetId });
    setNotice("Next week's review was written to the sheet.");
  }
  async function syncAll() {
    if (batchController.current) return;
    const controller = new AbortController();
    batchController.current = controller;
    setBatchRunning(true);
    setBusy(true);
    setError("");
    setNotice("");
    setBatch([]);
    try {
      const current = await calendarRequest<State>(endpoint, {
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(20000),
        ]),
      });
      setState((old) => ({ ...old, ...current }));
      const results = await syncAllTables(
        current.datasets,
        (id) =>
          calendarRequest<SyncResult>(endpoint, {
            method: "POST",
            body: JSON.stringify({ action: "sync", dataset_id: id }),
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(120000),
            ]),
          }),
        (value) => {
          if (!controller.signal.aborted) setBatch(value);
        },
        () => controller.signal.aborted,
      );
      if (controller.signal.aborted) return;
      const synced = results.filter((r) => r.status === "synced").length;
      const attention = results.length - synced;
      setNotice(
        results.length
          ? `${synced} of ${results.length} tables synced.${attention ? ` ${attention} need attention; see the results below.` : " Everything is up to date."}`
          : "No active tables to sync. Paused tables and test workbooks are skipped.",
      );
      window.dispatchEvent(new Event("lifeos:changed"));
      try {
        await load();
        await refresh();
      } catch {
        setError(
          "Sync results are shown below, but the latest table details could not load. Refresh this page.",
        );
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Could not start synchronization.",
        );
    } finally {
      batchController.current = null;
      if (!controller.signal.aborted) {
        setBusy(false);
        setBatchRunning(false);
      }
    }
  }
  function confirmMode(
    mode: string,
    outbound = d?.outbound_enabled ?? false,
    automatic = d?.automatic_outbound ?? false,
  ) {
    if (!d) return;
    if (
      !window.confirm(
        outbound
          ? "Authorize writes to this specific mapped table? Approved fields only. Google Sheets cannot guarantee an atomic compare-and-write; a concurrent external edit can still race the final preflight."
          : "Save this table’s synchronization settings?",
      )
    )
      return;
    void act({
      action: "mode",
      dataset_id: d.id,
      version: d.version,
      mode,
      outbound_enabled: outbound,
      automatic_outbound: automatic,
      confirmed: true,
    });
  }
  return (
    <section
      className="panel settings-panel"
      aria-label="Two-way Google Sheets"
    >
      <h2>Google Sheets</h2>
      <Button
        disabled={
          busy ||
          !state?.datasets.some((t) => !t.test_only && t.mode !== "paused")
        }
        onClick={() => void syncAll()}
      >
        {batchRunning ? "Syncing tables…" : "Sync Sheets tables"}
      </Button>

      {batch.length > 0 && (
        <section
          aria-label="Sync all results"
          aria-live="polite"
          aria-atomic="true"
        >
          {batchRunning && (
            <p className="small">Keep this page open while your tables sync.</p>
          )}
          <p className="small">
            {
              batch.filter((r) => !["waiting", "syncing"].includes(r.status))
                .length
            }{" "}
            of {batch.length} checked
          </p>
          {batch.map((r) => (
            <div className="setting-line" key={r.id}>
              <strong>{r.title}</strong>
              <span>
                {
                  {
                    waiting: "Waiting",
                    syncing: "Syncing…",
                    synced: "Synced",
                    attention: "Needs review",
                    failed: "Sync not confirmed",
                  }[r.status]
                }
                {r.message ? ` · ${r.message}` : ""}
              </span>
            </div>
          ))}
        </section>
      )}
      <details>
        <summary>Connection setup and tests</summary>
        <div className="stack">
          <label className="tech-detail">
            Connected Google account
            <select
              value={connection}
              onChange={(e) => setConnection(e.target.value)}
            >
              {!connections.length && (
                <option value="">Connect Google first</option>
              )}
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  Connected account · {c.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await calendarRequest<{ url: string }>(
                  "/api/v1/calendar/oauth/start",
                  {
                    method: "POST",
                    body: JSON.stringify({ sheets: true, sheets_write: true }),
                  },
                );
                const redirect = new URL(r.url).searchParams.get(
                  "redirect_uri",
                );
                if (
                  redirect &&
                  new URL(redirect).origin !== window.location.origin
                ) {
                  setError(
                    "Google consent must be completed on the primary Life OS site. Open the link below, use its Connect Sheets write permission control, then return to this preview.",
                  );
                  setBusy(false);
                  return;
                }
                window.location.assign(r.url);
              } catch {
                setError("Google authorization could not start.");
                setBusy(false);
              }
            }}
          >
            Reconnect Google Sheets
          </Button>
          <a
            className="button button-outline tech-detail"
            href="https://lifeos-beta-ivory.vercel.app/settings?section=integrations"
            target="_blank"
            rel="noreferrer"
          >
            Open primary Life OS integration settings
          </a>
        </div>
        <details className="tech-detail">
          <summary>Verify a disposable workbook</summary>
          <p className="small muted">
            Creates a clearly labelled synthetic workbook. Tests imports,
            approved writes, conflicts, row moves, additions, deletions,
            formulas, formatting and duplicate prevention. Your existing
            workbooks are not modified.
          </p>
          <Button
            disabled={busy || !connection}
            onClick={() => {
              if (
                !window.confirm(
                  "Create a disposable Google spreadsheet for synchronization tests?",
                )
              )
                return;
              const request = testRequest || crypto.randomUUID();
              setTestRequest(request);
              void act({
                action: "create_test",
                connection_id: connection,
                request_id: request,
                confirmed: true,
              });
            }}
          >
            Create test workbook
          </Button>
          {state?.tests.map((t) => (
            <div className="stack" key={t.id}>
              <strong>Test: {t.status}</strong>
              {t.spreadsheet_url && (
                <a href={t.spreadsheet_url} target="_blank" rel="noreferrer">
                  Open disposable workbook
                </a>
              )}
              <p className="small">
                {Object.keys(t.results)
                  .filter((k) => t.results[k])
                  .join(" · ")}
              </p>
              {t.last_error && <p className="error-message">{t.last_error}</p>}
              <Button
                variant="outline"
                disabled={busy || !["ready"].includes(t.status)}
                onClick={() =>
                  void act({
                    action: "verify_test",
                    test_id: t.id,
                    confirmed: true,
                  })
                }
              >
                Run live verification
              </Button>
            </div>
          ))}
        </details>
        <details>
          <summary>Connect a table</summary>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                setMeta(
                  await calendarRequest<Metadata>(endpoint, {
                    method: "POST",
                    body: JSON.stringify({
                      action: "metadata",
                      connection_id: connection,
                      spreadsheet_id: spreadsheet,
                    }),
                  }),
                );
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Metadata read failed.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Spreadsheet ID
              <input
                required
                value={spreadsheet}
                onChange={(e) => {
                  setSpreadsheet(e.target.value.trim());
                  setMeta(null);
                }}
                minLength={10}
                maxLength={200}
              />
            </label>
            <Button variant="outline" disabled={busy || !connection}>
              Inspect worksheets
            </Button>
          </form>
          {meta && (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                try {
                  const config = datasetConfig.parse({
                    sheet_id: Number(f.get("sheet")),
                    header_row: Number(f.get("header")) - 1,
                    end_row: Number(f.get("end")),
                    start_column: Number(f.get("start")) - 1,
                    end_column: Number(f.get("last")),
                    allow_insert: f.get("insert") === "on",
                    allow_delete: f.get("delete") === "on",
                    columns: String(f.get("mapping"))
                      .split("\n")
                      .filter(Boolean)
                      .map((line) => {
                        const [key, header, type, access] = line
                          .split("|")
                          .map((s) => s.trim());
                        return {
                          key,
                          header,
                          type,
                          key_part: access === "id",
                          writable: access === "write",
                        };
                      }),
                  });
                  void act({
                    action: "register",
                    connection_id: connection,
                    spreadsheet_id: spreadsheet,
                    config,
                    confirmed: true,
                  }).then((r) => {
                    if (r?.dataset_id) {
                      setSelected(String(r.dataset_id));
                      void load(String(r.dataset_id));
                    }
                  });
                } catch {
                  setError(
                    "Check the table range and mapping. Each line needs key | exact header | text/number/integer/boolean | id/read/write, with at least one stable ID.",
                  );
                }
              }}
            >
              <strong>{meta.properties.title}</strong>
              <label>
                Worksheet
                <select name="sheet">
                  {meta.sheets.map((s) => (
                    <option
                      value={s.properties.sheetId}
                      key={s.properties.sheetId}
                    >
                      {s.properties.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Header row (1-based)
                <input
                  name="header"
                  type="number"
                  min={1}
                  defaultValue={1}
                  required
                />
              </label>
              <label>
                Last included row
                <input
                  name="end"
                  type="number"
                  min={3}
                  max={5001}
                  defaultValue={100}
                  required
                />
              </label>
              <label>
                First column number (A = 1)
                <input
                  name="start"
                  type="number"
                  min={1}
                  max={200}
                  defaultValue={1}
                  required
                />
              </label>
              <label>
                Last column number
                <input
                  name="last"
                  type="number"
                  min={1}
                  max={200}
                  defaultValue={5}
                  required
                />
              </label>
              <label>
                Field mapping
                <textarea
                  name="mapping"
                  required
                  rows={4}
                  placeholder={
                    "id | Record ID | text | id\nstatus | Status | text | write"
                  }
                />
              </label>
              <p className="small muted">
                One field per line: key | exact source header | type | id, read
                or write. Identity must remain stable when rows move. Formula
                columns must use read. Blank rows are used for additions;
                existing worksheet rows are never shifted or removed.
              </p>
              <label>
                <input type="checkbox" name="insert" /> Allow reviewed additions
              </label>
              <label>
                <input type="checkbox" name="delete" /> Allow reviewed clearing
                of literal mapped records
              </label>
              <Button disabled={busy}>Connect and import</Button>
            </form>
          )}
        </details>
      </details>
      <label>
        Connected tables
        <select
          value={selected}
          disabled={busy}
          onChange={(e) => {
            setSelected(e.target.value);
            void load(e.target.value);
          }}
        >
          <option value="">Choose a table</option>
          {state?.datasets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.test_only ? "[TEST] " : ""}
              {s.title} · {s.worksheet_title}
            </option>
          ))}
        </select>
      </label>
      {d && (
        <div className="stack">
          <a
            href={`https://docs.google.com/spreadsheets/d/${d.spreadsheet_id}/edit`}
            target="_blank"
            rel="noreferrer"
          >
            Open source spreadsheet
          </a>
          <p className="small muted">
            {d.mode === "life_os_owned"
              ? "Life OS writes here automatically"
              : "Sync mode: " + d.mode.replace(/_/g, " ")}
            {" · Updated "}
            {d.last_read_at ? stamp(d.last_read_at) : "never"}
            {d.last_write_at ? " · Last write " + stamp(d.last_write_at) : ""}
          </p>
          {d.last_error && (
            <p role="alert" className="error-message">
              {d.last_error}
            </p>
          )}
          <div className="stack">
            <Button
              disabled={busy || d.mode === "paused"}
              onClick={() => void act({ action: "sync", dataset_id: d.id })}
            >
              Sync now
            </Button>
            {d.mode === "life_os_owned" &&
              d.config.columns.some((c) => c.key === "week_of") && (
                <Button disabled={busy} onClick={() => void buildReview(d.id)}>
                  Build next week&apos;s review
                </Button>
              )}
          </div>
          <h3>Outgoing changes</h3>
          {!state?.operations?.length && (
            <p className="small muted">No pending changes.</p>
          )}
          {state?.operations?.map((o) => (
            <div className="stack" key={o.id}>
              <strong>
                {o.operation_type} · {o.status}
              </strong>
              <p className="small" style={{ overflowWrap: "anywhere" }}>
                {JSON.stringify(o.intended)}
              </p>
              {o.last_error && <p className="error-message">{o.last_error}</p>}
              {o.status === "draft" && (
                <Button
                  disabled={busy || !d.outbound_enabled}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Approve these exact fields for Google Sheets? Sync now will recheck the source before writing.",
                      )
                    )
                      void act({
                        action: "approve",
                        dataset_id: d.id,
                        operation_id: o.id,
                        version: o.version,
                        confirmed: true,
                      });
                  }}
                >
                  Approve write
                </Button>
              )}
            </div>
          ))}
          <details>
            <summary>Change log and undo</summary>
            {!state?.change_log?.length && (
              <p className="small muted">No confirmed changes yet.</p>
            )}
            {state?.change_log?.map((c) => (
              <div className="stack" key={c.id}>
                <p className="small" style={{ overflowWrap: "anywhere" }}>
                  {c.verified_at ? stamp(c.verified_at) : ""} ·{" "}
                  {c.operation_type} · {JSON.stringify(c.intended)}
                </p>
                {c.operation_type === "update" && (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Restore the previous values? This creates a new change you can review.",
                        )
                      )
                        void act({
                          action: "undo",
                          dataset_id: d.id,
                          operation_id: c.id,
                          confirmed: true,
                        });
                    }}
                  >
                    Undo
                  </Button>
                )}
              </div>
            ))}
          </details>
          {state?.more_operations && (
            <p>
              More operations are pending. Process these before the next batch.
            </p>
          )}
          <details>
            <summary>Settings, records and history</summary>
            <label>
              Direction
              <select
                value={d.mode}
                disabled={busy}
                onChange={(e) => confirmMode(e.target.value)}
              >
                <option value="import_only">Import only</option>
                <option value="export_only">Export only</option>
                <option value="two_way">Two-way</option>
                <option value="life_os_owned" disabled>
                  Life OS is the source of truth
                </option>
                <option value="paused">Paused</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={d.outbound_enabled}
                disabled={busy}
                onChange={(e) =>
                  confirmMode(
                    d.mode,
                    e.target.checked,
                    e.target.checked && d.automatic_outbound,
                  )
                }
              />{" "}
              Authorize outbound writes for this table
            </label>
            <label>
              <input
                type="checkbox"
                checked={d.automatic_outbound}
                disabled={busy || !d.outbound_enabled}
                onChange={(e) => confirmMode(d.mode, true, e.target.checked)}
              />{" "}
              Automatically approve future validated edits
            </label>
            <details>
              <summary>Advanced connection settings</summary>
              <p className="small muted">
                Pause this table and disable outbound writes first. Preserve
                field keys, types and identity; update exact headers and bounded
                ranges when the worksheet changes.
              </p>
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  try {
                    const config = datasetConfig.parse(
                      JSON.parse(
                        String(new FormData(e.currentTarget).get("config")),
                      ),
                    );
                    void act({
                      action: "configure",
                      dataset_id: d.id,
                      version: d.version,
                      config,
                      confirmed: true,
                    });
                  } catch {
                    setError("Enter a valid mapping configuration.");
                  }
                }}
              >
                <label>
                  Mapping configuration
                  <textarea
                    name="config"
                    rows={8}
                    defaultValue={JSON.stringify(d.config, null, 2)}
                    key={d.id + ":" + d.version}
                    required
                  />
                </label>
                <Button
                  disabled={busy || d.mode !== "paused" || d.outbound_enabled}
                >
                  Save reviewed mapping
                </Button>
              </form>
            </details>
            <h3>Records</h3>
            {!state?.rows?.length && (
              <p className="small muted">No imported records on this page.</p>
            )}
            {state?.rows?.map((r) => (
              <details key={r.id}>
                <summary>
                  {String(
                    r.local_values[
                      d.config.columns.find((c) => c.key_part)!.key
                    ] ?? r.id,
                  )}{" "}
                  · {r.state}
                </summary>
                <RowEditor
                  key={r.id + ":" + r.version}
                  row={r}
                  config={d.config}
                  busy={busy}
                  save={(values) =>
                    void act({
                      action: "edit",
                      dataset_id: d.id,
                      row_id: r.id,
                      version: r.version,
                      request_id: crypto.randomUUID(),
                      values,
                    })
                  }
                />
                <details>
                  <summary>Link to an existing project status</summary>
                  <p className="small muted">
                    This connects future project-status edits in either
                    direction. First align the current project status and source
                    value; no project is guessed from its title.
                  </p>
                  <form
                    className="stack"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      const p = workspace.projects.find(
                        (p) => p.id === f.get("project"),
                      );
                      if (!p) return;
                      void act({
                        action: "bind_project",
                        dataset_id: d.id,
                        row_id: r.id,
                        version: r.version,
                        project_id: p.id,
                        project_version: p.version,
                        field: String(f.get("field")),
                        values_map: Object.fromEntries(
                          ["active", "paused", "completed", "cancelled"].map(
                            (k) => [k, String(f.get(k))],
                          ),
                        ),
                        confirmed: true,
                      });
                    }}
                  >
                    <label>
                      Existing project
                      <select name="project" required>
                        {workspace.projects
                          .filter(availableProject)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} · {p.status}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Status field
                      <select name="field" required>
                        {d.config.columns
                          .filter(
                            (c) =>
                              c.writable && c.type === "text" && !c.key_part,
                          )
                          .map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.header}
                            </option>
                          ))}
                      </select>
                    </label>
                    {["active", "paused", "completed", "cancelled"].map((k) => (
                      <label key={k}>
                        Sheets value for {k}
                        <input
                          name={k}
                          required
                          maxLength={100}
                          defaultValue={k}
                        />
                      </label>
                    ))}
                    <Button disabled={busy || !workspace.projects.length}>
                      Confirm project link
                    </Button>
                  </form>
                </details>
                {Object.entries(r.conflicts).map(([key, c]) => (
                  <div key={key} className="stack">
                    <strong>Conflict: {key}</strong>
                    <p className="small">
                      Last confirmed: {String(c.base ?? "empty")} · Life OS:{" "}
                      {String(c.local ?? "empty")} · Sheets:{" "}
                      {String(c.remote ?? "empty")}
                    </p>
                    {(["remote", "local"] as const).map((keep) => (
                      <Button
                        key={keep}
                        variant="outline"
                        disabled={
                          busy ||
                          (keep === "local" && !r.remote_cells[key]?.writable)
                        }
                        onClick={() =>
                          void act({
                            action: "resolve",
                            dataset_id: d.id,
                            row_id: r.id,
                            version: r.version,
                            field: key,
                            keep,
                            confirmed: true,
                          })
                        }
                      >
                        Keep {keep === "remote" ? "Sheets" : "Life OS"} value
                      </Button>
                    ))}
                  </div>
                ))}
                {d.config.allow_delete && r.state !== "deleted" && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Draft clearing this mapped source record? No worksheet rows will be shifted. A separate approval is required.",
                        )
                      )
                        void act({
                          action: "delete",
                          dataset_id: d.id,
                          row_id: r.id,
                          version: r.version,
                          request_id: crypto.randomUUID(),
                          confirmed: true,
                        });
                    }}
                  >
                    Draft deletion
                  </Button>
                )}
              </details>
            ))}
            {state?.next && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void load(d.id, state.next!)}
              >
                Load more records
              </Button>
            )}
            {d.config.allow_insert && (
              <details>
                <summary>Add a record</summary>
                <RowEditor
                  key={d.id}
                  config={d.config}
                  busy={busy}
                  save={(values) =>
                    void act({
                      action: "insert",
                      dataset_id: d.id,
                      request_id: crypto.randomUUID(),
                      values,
                    })
                  }
                />
              </details>
            )}
            <details>
              <summary>Recent synchronization history</summary>
              {state?.runs?.map((r) => (
                <p className="small" key={r.id}>
                  {stamp(r.started_at)} · {r.status} ·{" "}
                  {JSON.stringify(r.summary)}
                </p>
              ))}
            </details>
          </details>
        </div>
      )}
      {busy && !batchRunning && (
        <p role="status">Working… Keep this page open during verification.</p>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="small">
          {notice}
        </p>
      )}
    </section>
  );
}
export function RowEditor({
  row,
  config,
  busy,
  save,
}: {
  row?: Row;
  config: DatasetConfig;
  busy: boolean;
  save: (values: Values) => void;
}) {
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget),
          values: Values = {};
        for (const c of config.columns) {
          if (!c.writable && !(c.key_part && !row)) continue;
          if (row && (c.key_part || !row.remote_cells[c.key]?.writable))
            continue;
          const v = String(f.get(c.key) ?? "");
          values[c.key] =
            v === ""
              ? null
              : c.type === "number" || c.type === "integer"
                ? Number(v)
                : c.type === "boolean"
                  ? v === "true"
                  : v;
        }
        save(values);
      }}
    >
      {config.columns.map((c) => {
        const cell = row?.remote_cells[c.key],
          editable = row
            ? cell?.writable && !c.key_part
            : c.writable || c.key_part;
        return (
          <label key={c.key}>
            {c.header}
            {cell?.formula ? " · Formula (read-only)" : ""}
            {editable && c.type === "boolean" ? (
              <select
                name={c.key}
                defaultValue={String(row?.local_values[c.key] ?? "")}
                disabled={busy}
              >
                <option value="">Unknown / clear</option>
                <option value="true">True</option>
                <option value="false">False</option>
              </select>
            ) : editable ? (
              <input
                name={c.key}
                defaultValue={String(row?.local_values[c.key] ?? "")}
                disabled={busy}
                type={
                  ["number", "integer"].includes(c.type) ? "number" : "text"
                }
                step={c.type === "integer" ? 1 : "any"}
                required={c.key_part}
              />
            ) : (
              <span className="small">
                {String(row?.local_values[c.key] ?? "Unknown")}
              </span>
            )}
          </label>
        );
      })}
      {(!row ||
        !["deleted", "source_missing", "conflict"].includes(row.state)) && (
        <Button disabled={busy}>
          {row ? "Save pending edit" : "Create pending record"}
        </Button>
      )}
    </form>
  );
}
