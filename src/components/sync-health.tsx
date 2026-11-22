"use client";
import { useState } from "react";
import { calendarRequest } from "./use-calendar";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import type { BriefingController } from "./use-briefing";
import { Button } from "./ui/button";
export function SyncHealth({
  controller: c,
}: {
  controller: BriefingController;
}) {
  const h = c.data?.sync_health;
  const [checking, setChecking] = useState(false);
  const [diagnostic, setDiagnostic] = useState("");
  return (
    <section className="panel sync-health" aria-label="Connected data status">
      <div className="flex-between">
        <div>
          <h2>Connected data</h2>
          <p>
            {!h
              ? c.error
                ? "Status unavailable"
                : "Checking connections…"
              : h.status === "needs_attention"
                ? `${h.affected} ${h.affected === 1 ? "source needs" : "sources need"} attention`
                : h.status === "connected"
                  ? "Connected"
                  : "No connections"}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={c.loading}
          onClick={() => void c.reload()}
        >
          Reread saved status
        </Button>
      </div>
      {h && (
        <>
          <p className="small muted">
            {h.last_coverage_at
              ? `Updated through ${formatInTimeZone(h.last_coverage_at, c.data!.timezone, "MMM d, h:mm a")}`
              : "No complete refresh yet."}
          </p>
          <details className="briefing-detail">
            <summary>Connection details</summary>
            <p className="small muted">
              The date represents the oldest successful refresh among your
              enabled sources. They refresh on their own schedules; any newer
              failure is shown below.
            </p>
            {h.sources.map((s) => (
              <div className="setting-line" key={s.id}>
                <strong>{s.name}</strong>
                <span className={s.issue ? "error-message" : "small muted"}>
                  {s.issue || "Connected"}
                </span>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              disabled={checking}
              onClick={async () => {
                setChecking(true);
                setDiagnostic("");
                try {
                  const result = await calendarRequest<{ message: string }>(
                    "/api/v1/integrations/health",
                    {
                      method: "POST",
                      body: "{}",
                      signal: AbortSignal.timeout(45000),
                    },
                  );
                  setDiagnostic(result.message);
                } catch {
                  setDiagnostic(
                    "The connection check did not finish. Your records have not been changed.",
                  );
                } finally {
                  setChecking(false);
                }
              }}
            >
              {checking ? "Checking Google…" : "Check Google connection"}
            </Button>
            {diagnostic && (
              <p role="status" className="small">
                {diagnostic}
              </p>
            )}
            <Link className="text-link" href="/settings?section=integrations">
              Manage connections
            </Link>
          </details>
        </>
      )}
    </section>
  );
}
