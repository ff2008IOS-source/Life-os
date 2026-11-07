"use client";
import { useState, useEffect } from "react";
import { calendarRequest } from "./use-calendar";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
type Source = {
  id: string;
  title: string;
  spreadsheet_id: string;
  mode: string;
  last_success_at: string | null;
  last_error: string | null;
};
type Mapping = {
  id: string;
  source_id: string;
  external_id: string;
  project_id: string;
  version: number;
  conflict: {
    kind: string;
    local: string;
    base: string;
    remote: string;
    project_version: number;
  } | null;
};
type State = { sources: Source[]; mappings: Mapping[]; pending: unknown[] };
export function SheetSyncPanel() {
  const { data, refresh } = useWorkspace();
  const [state, setState] = useState<State | null>(null),
    [connections, setConnections] = useState<{ id: string; status: string }[]>(
      [],
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function load() {
    setState(await calendarRequest<State>("/api/v1/sheets/sync"));
  }
  useEffect(() => {
    let live = true;
    void Promise.all([
      calendarRequest<State>("/api/v1/sheets/sync"),
      calendarRequest<{ connections: { id: string; status: string }[] }>(
        "/api/v1/calendar/connections",
      ),
    ])
      .then(([s, c]) => {
        if (live) {
          setState(s);
          setConnections(c.connections.filter((x) => x.status === "connected"));
        }
      })
      .catch(() => {
        if (live)
          setError("Spreadsheet synchronization settings could not be loaded.");
      });
    return () => {
      live = false;
    };
  }, []);
  async function act(body: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await calendarRequest("/api/v1/sheets/sync", {
        method: "POST",
        body: JSON.stringify(body),
      });
      await load();
      await refresh();
      setNotice("Saved. No Google Sheets writes were made.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Spreadsheet operation failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel settings-panel">
      <h2>Mapped spreadsheet sync</h2>
      <p className="small muted">
        Project-status import with stable source IDs and conflict review.
        Outbound writes remain unavailable until provider revision checks and
        separate write permission are verified on a test workbook. Your existing
        career workbook remains read-only.
      </p>
      <Button
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const result = await calendarRequest<{ url: string }>(
              "/api/v1/calendar/oauth/start",
              {
                method: "POST",
                body: JSON.stringify({ sheets: true, sheets_write: true }),
              },
            );
            window.location.assign(result.url);
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "Google authorization could not start.",
            );
            setBusy(false);
          }
        }}
      >
        Connect Sheets write permission
      </Button>
      <Button
        variant="outline"
        disabled={busy || !connections.length}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const r = await calendarRequest<{ message: string }>(
              "/api/v1/sheets/sync",
              {
                method: "POST",
                body: JSON.stringify({
                  action: "probe",
                  connection_id: connections[0].id,
                }),
              },
            );
            setNotice(r.message);
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Readiness check failed.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        Check Sheets readiness
      </Button>
      <p className="form-hint">
        Google requires a consent step before Life OS can edit spreadsheets.
        Writes remain restricted to approved mappings and verified provider
        safeguards.
      </p>
      {state?.sources.map((s) => (
        <div key={s.id} className="stack">
          <strong>{s.title}</strong>
          <p className="small muted">
            {s.mode === "paused" ? "Paused" : "Import only"} · Last successful
            check:{" "}
            {s.last_success_at
              ? new Date(s.last_success_at).toLocaleString()
              : "Not yet checked"}
          </p>
          {s.last_error && <p className="error-message">{s.last_error}</p>}
          <div className="career-import-actions">
            <Button
              size="sm"
              disabled={busy || s.mode === "paused"}
              onClick={() => void act({ action: "sync", source_id: s.id })}
            >
              Sync now
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void act({
                  action: "mode",
                  source_id: s.id,
                  mode: s.mode === "paused" ? "import_only" : "paused",
                })
              }
            >
              {s.mode === "paused" ? "Resume imports" : "Pause"}
            </Button>
            <a
              className="text-link"
              href={`https://docs.google.com/spreadsheets/d/${s.spreadsheet_id}/edit`}
              target="_blank"
              rel="noreferrer"
            >
              Open spreadsheet
            </a>
          </div>
          {state.mappings
            .filter((m) => m.source_id === s.id)
            .map((m) => (
              <div className="setting-line" key={m.id}>
                <div>
                  <strong>
                    {data.projects.find((p) => p.id === m.project_id)?.name ??
                      "Linked project"}
                  </strong>
                  <p className="small">Source ID: {m.external_id}</p>
                  {m.conflict && (
                    <p className="small">
                      Needs review ({m.conflict.kind}): Life OS{" "}
                      {m.conflict.local}; Sheets{" "}
                      {m.conflict.remote ?? "missing"}; baseline{" "}
                      {m.conflict.base}.
                    </p>
                  )}
                </div>
                {m.conflict &&
                  ["concurrent_edit", "initial_difference"].includes(
                    m.conflict.kind,
                  ) && (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(
                            "Use the reviewed Google Sheets status for this project? Other project fields and the spreadsheet remain unchanged.",
                          )
                        )
                          void act({
                            action: "accept_sheet",
                            source_id: s.id,
                            mapping_id: m.id,
                            mapping_version: m.version,
                            project_version: m.conflict!.project_version,
                            remote_value: m.conflict!.remote,
                            confirmed: true,
                          });
                      }}
                    >
                      Use Sheets value
                    </Button>
                  )}
              </div>
            ))}
        </div>
      ))}
      <details>
        <summary className="text-link">Connect a test workbook</summary>
        <p className="form-hint">
          Use an existing authorized workbook. This registers read-only access
          and does not create, restructure or edit a spreadsheet.
        </p>
        <form
          className="academic-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void act({
              action: "register",
              connection_id: f.get("connection"),
              spreadsheet_id: f.get("spreadsheet"),
            });
          }}
        >
          <label>
            Connected Google account
            <select name="connection" required defaultValue="">
              <option value="">Choose connection</option>
              {connections.map((c, i) => (
                <option key={c.id} value={c.id}>
                  Google connection {i + 1}
                </option>
              ))}
            </select>
          </label>
          <label>
            Spreadsheet ID
            <input name="spreadsheet" required minLength={10} maxLength={200} />
          </label>
          <Button disabled={busy || !connections.length}>
            Register read-only workbook
          </Button>
        </form>
      </details>
      {!!state?.sources.length && (
        <details>
          <summary className="text-link">Map one project status</summary>
          <p className="form-hint">
            The first row must contain unique headers. Use a literal, unique ID
            in the first 2,000 rows and columns A–Z. Row positions are never
            used as identities. Do not add IDs or alter your existing career
            workbook as part of this test.
          </p>
          <form
            className="academic-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act({
                action: "map",
                source_id: f.get("source"),
                sheet_id: Number(f.get("sheet")),
                external_id: f.get("external"),
                id_column: f.get("idcolumn"),
                status_column: f.get("statuscolumn"),
                project_id: f.get("project"),
                remote_values: {
                  active: f.get("active"),
                  paused: f.get("paused"),
                  completed: f.get("completed"),
                  cancelled: f.get("cancelled"),
                },
                confirmed: true,
              });
            }}
          >
            <label>
              Registered workbook
              <select name="source" required>
                {state.sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Worksheet ID (gid)
              <input
                name="sheet"
                type="number"
                min="0"
                required
                defaultValue="0"
              />
            </label>
            <label>
              Stable ID column header
              <input name="idcolumn" required defaultValue="ID" />
            </label>
            <label>
              Status column header
              <input name="statuscolumn" required defaultValue="Status" />
            </label>
            <label>
              External record ID
              <input name="external" required maxLength={200} />
            </label>
            <label>
              Life OS project
              <select name="project" required defaultValue="">
                <option value="">Choose project</option>
                {data.projects.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {["active", "paused", "completed", "cancelled"].map((k) => (
              <label key={k}>
                Spreadsheet value for {k}
                <input name={k} required defaultValue={k} maxLength={100} />
              </label>
            ))}
            <Button disabled={busy}>Map and review differences</Button>
          </form>
        </details>
      )}
      {!!state?.pending.length && (
        <p className="small">
          Pending outbound records: {state.pending.length}. Provider writes are
          not activated.
        </p>
      )}
      {notice && (
        <p className="form-hint" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
