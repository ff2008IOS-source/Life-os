"use client";
import { useRef, useState } from "react";
import { calendarRequest } from "./use-calendar";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import type { ConnectionState } from "@/lib/integrations/calendar-view";
import type { Dataset } from "./sheet-rest-panel";
type Result = {
  name: string;
  state: "updated" | "attention" | "failed" | "skipped";
  message: string;
};
export function ConnectedSyncAll() {
  const { refresh } = useWorkspace();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false),
    [results, setResults] = useState<Result[]>([]);
  async function sync() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setResults([]);
    const report = (r: Result) => setResults((old) => [...old, r]);
    async function step(
      name: string,
      run: () => Promise<string | Pick<Result, "state" | "message">>,
    ) {
      try {
        const result = await run();
        report(
          typeof result === "string"
            ? { name, state: "updated", message: result }
            : { name, ...result },
        );
      } catch (e) {
        report({
          name,
          state: "failed",
          message:
            e instanceof Error ? e.message : "Could not confirm this refresh.",
        });
      }
    }
    try {
      await step("Canvas", async () => {
        const c = await calendarRequest<{
          connected: boolean;
          connection?: { enabled: boolean } | null;
        }>("/api/canvas/connection");
        if (!c.connected || !c.connection?.enabled)
          return {
            state: "skipped",
            message: "Not connected; saved academic records are preserved.",
          };
        const r = await calendarRequest<{
          processed: number;
          pending: number;
          errors: number;
        }>("/api/canvas/sync?refresh=true", { method: "POST" });
        if (r.errors)
          throw Error(
            "Some Canvas resources could not refresh. Check connection details.",
          );
        return r.pending
          ? {
              state: "attention",
              message: `${r.processed} resources processed; ${r.pending} remain queued. Saved data is available.`,
            }
          : "Connected academic records refreshed.";
      });
      await step("Google Calendar", async () => {
        const c = await calendarRequest<ConnectionState>(
          "/api/v1/calendar/connections",
        );
        const selected = c.calendars.filter((c) => c.sync_enabled);
        let failed = 0;
        for (const calendar of selected) {
          try {
            await calendarRequest("/api/v1/calendar/sync", {
              method: "POST",
              body: JSON.stringify({ calendar_id: calendar.id }),
            });
          } catch {
            failed++;
          }
        }
        if (failed)
          throw Error(
            `${selected.length - failed} of ${selected.length} calendars refreshed. Check the remaining connections.`,
          );
        return selected.length
          ? `${selected.length} calendars refreshed.`
          : {
              state: "skipped",
              message: "No calendars selected; saved events are preserved.",
            };
      });
      await step("Google Sheets", async () => {
        const c = await calendarRequest<{ datasets: Dataset[] }>(
          "/api/v1/sheets/tables",
        );
        const tables = c.datasets.filter(
          (t) => !t.test_only && t.mode !== "paused",
        );
        let updated = 0,
          attention = 0;
        for (const table of tables) {
          try {
            const r = await calendarRequest<{
              conflicts?: number;
              held_outbound?: boolean;
            }>("/api/v1/sheets/tables", {
              method: "POST",
              body: JSON.stringify({ action: "sync", dataset_id: table.id }),
            });
            if (r.conflicts || r.held_outbound) {
              attention++;
              report({
                name: table.title,
                state: "attention",
                message:
                  "Source refreshed; pending changes need review. Local work was not rebuilt from unresolved rows.",
              });
              continue;
            }
            updated++;
            const rebuilt = await calendarRequest<{
              enabled: boolean;
              created: number;
              updated?: number;
              conflicts?: number;
              skipped?: number;
            }>("/api/v1/workspace/rebuild", {
              method: "POST",
              body: JSON.stringify({ dataset_id: table.id }),
            });
            if (rebuilt.conflicts) {
              attention++;
              report({
                name: table.title,
                state: "attention",
                message:
                  "Your local edits were preserved. Review changed source records before replacing them.",
              });
            } else
              report({
                name: table.title,
                state: "updated",
                message: rebuilt.enabled
                  ? `Source refreshed. ${rebuilt.created} ${rebuilt.created === 1 ? "record" : "records"} rebuilt; ${rebuilt.updated ?? 0} updated. Completed/future actions stay in the source plan.`
                  : "Source refreshed.",
              });
          } catch (e) {
            attention++;
            report({
              name: table.title,
              state: "failed",
              message:
                e instanceof Error
                  ? e.message
                  : "Refresh could not be confirmed.",
            });
          }
        }
        if (attention)
          throw Error(
            `${updated} of ${tables.length} tables refreshed without a provider failure; ${attention} results need attention below.`,
          );
        return tables.length
          ? `${tables.length} tables refreshed.`
          : {
              state: "skipped",
              message:
                "No active tables. Paused and test workbooks are skipped.",
            };
      });
    } finally {
      lock.current = false;
      setBusy(false);
      try {
        await refresh();
      } catch {
        report({
          name: "Workspace",
          state: "failed",
          message:
            "Source refreshes finished, but the page could not reload. Refresh this page to check saved results.",
        });
      }
      window.dispatchEvent(new Event("lifeos:changed"));
    }
  }
  return (
    <section
      className="panel settings-panel"
      aria-label="Refresh connected data"
    >
      <div className="panel-heading">
        <h2>Connected data</h2>
        <Button disabled={busy} onClick={() => void sync()}>
          {busy ? "Syncing connected data…" : "Sync all"}
        </Button>
      </div>
      <p className="small muted">
        Refresh Canvas, selected calendars and active spreadsheets. Rebuild
        source-backed projects and current actions when enabled by your clean
        reset. Your existing outgoing-change approvals still apply.
      </p>
      <p role="status" aria-live="polite">
        {busy
          ? "Refreshing connected data…"
          : !results.length
            ? ""
            : results.some(
                  (r) => r.state === "failed" || r.state === "attention",
                )
              ? "Some connected data still needs attention. Open refresh details to see what remains."
              : results.some((r) => r.state === "updated")
                ? "Connected data refreshed."
                : "No active connections were refreshed."}
      </p>
      <details hidden={!results.length}>
        <summary>Refresh details</summary>
        {results.map((r, i) => (
          <p key={i}>
            <strong>{r.name}</strong> ·{" "}
            {r.state === "updated"
              ? "Updated"
              : r.state === "attention"
                ? "Needs review"
                : r.state === "skipped"
                  ? "Skipped"
                  : "Check connection"}
            <br />
            {r.message}
          </p>
        ))}
      </details>
    </section>
  );
}
