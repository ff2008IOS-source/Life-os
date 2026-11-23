"use client";
import { useEffect, useState } from "react";
import type { LiveBriefing } from "@/lib/briefing-server";
import { realWorkspace } from "@/lib/real-workspace";
import { PlanningDecisions } from "./planning-decisions";
import { useWorkspace } from "./workspace-provider";
import { useCurrentTime } from "./use-current-time";
import { useBriefing } from "./use-briefing";
import { BriefingPanel } from "./briefing-page";
import Link from "next/link";
import { SyncHealth } from "./sync-health";
import { AttentionHistory } from "./attention-history";
import { TodayView } from "./today-view";
import { Button } from "./ui/button";

export function HomePage({
  initialBriefing,
}: {
  initialBriefing?: LiveBriefing | null;
}) {
  const { data: raw, request, refresh, notify, pending } = useWorkspace();
  const data = realWorkspace(raw);
  const now = useCurrentTime();
  const briefing = useBriefing(undefined, initialBriefing);
  const planning = briefing.data?.planning;
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    const onHash = () => {
      if (
        ["#needs-attention", "#daily-briefing"].includes(window.location.hash)
      )
        setMoreOpen(true);
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const inbox = data.tasks
    .filter((t) => !t.deleted_at && t.status === "inbox")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const missed = planning?.blocks.filter(
    (b) => b.status === "planned" && Date.parse(b.end_at) < now.getTime(),
  );
  return (
    <div className="home-experience" id="daily-briefing">
      {!data.areas.length && (
        <div className="notice">
          <span>Set up your workspace to add courses and projects.</span>
          <Button
            disabled={pending}
            onClick={async () => {
              try {
                await request("/api/v1/workspace/initialize", {
                  method: "POST",
                });
                await refresh();
                notify("Workspace ready");
              } catch (e) {
                notify(e instanceof Error ? e.message : "Setup failed");
              }
            }}
          >
            Set up my space
          </Button>
        </div>
      )}
      <TodayView briefing={briefing} />
      <div className="td">
        {(!!missed?.length || !!briefing.data?.planning_decisions?.length) && (
          <PlanningDecisions
            initial={briefing.data?.planning_decisions}
            checkKey={
              missed
                ?.map((b) => b.id + ":" + b.start_at + ":" + b.end_at)
                .sort()
                .join("|") ?? ""
            }
            needsCheck={!!missed?.length}
          />
        )}
        <div className="td-footer">
          <button
            type="button"
            className="td-link"
            aria-expanded={moreOpen}
            onClick={() => {
              setMoreOpen(true);
              requestAnimationFrame(() =>
                document
                  .getElementById("day-review")
                  ?.scrollIntoView({ block: "start" }),
              );
            }}
          >
            Daily check-in
          </button>
          <Link className="td-link" href="/planner?section=inbox">
            Inbox{inbox.length ? ` · ${inbox.length}` : ""}
          </Link>
        </div>
        {moreOpen && (
          <section id="day-review" className="td-card" aria-label="Day review">
            <div className="td-card-head">
              <h2 className="td-card-title">Day review</h2>
              <button
                type="button"
                className="td-link"
                onClick={() => setMoreOpen(false)}
              >
                Close
              </button>
            </div>
            <BriefingPanel controller={briefing} hideConnectionAlerts />
            <div id="connected-data">
              <SyncHealth controller={briefing} />
            </div>
            <AttentionHistory />
          </section>
        )}
      </div>
    </div>
  );
}
