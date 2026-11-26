"use client";
import { useSearchParams } from "next/navigation";
import { PlanningDecisions } from "./planning-decisions";
import { visibleArea } from "@/lib/visible-areas";
import { realWorkspace } from "@/lib/real-workspace";
import { WorkSessionsPanel } from "./work-sessions-panel";
import { useEffect, useState } from "react";
import {
  addDays,
  addMonths,
  startOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  format,
} from "date-fns";
import { ChevronLeft, ChevronRight, Inbox, Plus } from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import { TaskList, EmptyState, QuickCapture } from "./task-list";
import { TaskEditor } from "./task-editor";
import { localDate } from "@/lib/dates";
import type { Task } from "@/lib/schemas";
import { OccurrencesPanel } from "./occurrences-panel";
import { SchedulingPanel } from "./scheduling-panel";
import { CanvasDeadlines } from "./canvas-deadlines";
import { PlannerCalendar } from "./planner-calendar";
import { EmailList } from "./course-updates";
export function PlannerPage({
  initialSection,
}: { initialSection?: string } = {}) {
  const { data: raw } = useWorkspace();
  const data = realWorkspace(raw);
  const selectedTask = useSearchParams().get("task");
  const [tab, setTab] = useState(
    ["calendar", "tasks", "inbox", "recurring", "schedule"].includes(
      initialSection ?? "",
    )
      ? initialSection!
      : "calendar",
  );
  const [view, setCalendarView] = useState("week");
  useEffect(() => {
    void Promise.resolve().then(() => {
      try {
        const saved = localStorage.getItem("lifeos:v1:calendar-view");
        setCalendarView(
          ["day", "week", "month", "agenda"].includes(saved ?? "")
            ? saved!
            : window.matchMedia("(max-width: 700px)").matches
              ? "agenda"
              : "week",
        );
      } catch {
        /* Optional preference. */
      }
    });
  }, []);
  function setView(next: string) {
    setCalendarView(next);
    try {
      localStorage.setItem("lifeos:v1:calendar-view", next);
    } catch {
      /* Optional preference. */
    }
  }
  const [anchor, setAnchor] = useState(
    () => new Date(localDate() + "T12:00:00"),
  );
  const [area, setArea] = useState("");
  const [status, setStatus] = useState("active");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<{ task: Task | null } | null>(() => {
    const task = data.tasks.find((t) => t.id === selectedTask);
    return task ? { task } : null;
  });
  const all = data.tasks.filter(
    (t) =>
      (status === "deleted" ? !!t.deleted_at : !t.deleted_at) &&
      (area ? t.area_id === area : true) &&
      t.title.toLowerCase().includes(search.toLowerCase()) &&
      (status === "active"
        ? !["completed", "cancelled"].includes(t.status)
        : status === "all" || status === "deleted"
          ? true
          : t.status === status),
  );
  const days =
    view === "month"
      ? eachDayOfInterval({
          start: startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 }),
          end: addDays(startOfWeek(endOfMonth(anchor), { weekStartsOn: 1 }), 6),
        })
      : view === "week"
        ? Array.from({ length: 7 }, (_, i) =>
            addDays(startOfWeek(anchor, { weekStartsOn: 1 }), i),
          )
        : [anchor];
  function navigate(direction: number) {
    setAnchor(
      view === "month"
        ? addMonths(anchor, direction)
        : addDays(anchor, direction * (view === "week" ? 7 : 1)),
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">TIME, WITH INTENTION</span>
          <h1>Planner</h1>
        </div>
        <Button onClick={() => setEditor({ task: null })}>
          <Plus size={14} />
          New task
        </Button>
      </div>
      <PlanningDecisions />
      <div className="tabs" role="tablist" aria-label="Planner section">
        {[
          { id: "calendar", label: "Calendar" },
          { id: "tasks", label: `Tasks · ${all.length}` },
          {
            id: "inbox",
            label: `Inbox · ${data.tasks.filter((t) => !t.deleted_at && t.status === "inbox").length}`,
          },
          { id: "recurring", label: "Recurring" },
          { id: "schedule", label: "Work hours & sessions" },
        ].map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? "active" : ""}`}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "schedule" ? (
        <>
          <SchedulingPanel />
          <WorkSessionsPanel />
        </>
      ) : tab === "recurring" ? (
        <OccurrencesPanel />
      ) : (
        <>
          {tab !== "calendar" && (
            <div className="filter-row">
              <input
                aria-label="Filter tasks by title"
                placeholder="Search tasks…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                aria-label="Filter life area"
                value={area}
                onChange={(e) => setArea(e.target.value)}
              >
                <option value="">All life areas</option>
                {data.areas.filter(visibleArea).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter task status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="active">Active tasks</option>
                <option value="all">All tasks</option>
                <option value="planned">Planned</option>
                <option value="in_progress">In progress</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
                <option value="deleted">Recently deleted</option>
              </select>
            </div>
          )}
          {tab === "calendar" ? (
            <>
              <div className="calendar-toolbar">
                <div className="inline">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Previous period"
                    onClick={() => navigate(-1)}
                  >
                    <ChevronLeft size={15} />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Next period"
                    onClick={() => navigate(1)}
                  >
                    <ChevronRight size={15} />
                  </Button>
                  <h2>{format(anchor, "MMMM yyyy")}</h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setAnchor(new Date(localDate() + "T12:00:00"))
                    }
                  >
                    Today
                  </Button>
                </div>
                <div className="segmented" aria-label="Calendar view">
                  {["day", "week", "month", "agenda"].map((v) => (
                    <button
                      key={v}
                      className={view === v ? "active" : ""}
                      aria-pressed={view === v}
                      onClick={() => setView(v)}
                    >
                      {v[0].toUpperCase() + v.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="planner-split">
                <div className="planner-main">
                  <PlannerCalendar
                    days={days}
                    view={view}
                    anchor={anchor}
                    tasks={data.tasks.filter(
                      (t) =>
                        !t.deleted_at &&
                        !["completed", "cancelled"].includes(t.status),
                    )}
                    onTask={(task) => setEditor({ task })}
                    onDay={setAnchor}
                    onManageSession={() => setTab("schedule")}
                  />
                </div>
                <aside className="planner-aside">
                  <CanvasDeadlines />
                </aside>
              </div>
            </>
          ) : (
            <section className="panel">
              <div className="panel-heading">
                <div className="panel-title">
                  <Inbox />
                  <h2>{tab === "inbox" ? "Your inbox" : "Your tasks"}</h2>
                </div>
              </div>
              {(tab === "inbox" ? all.filter((t) => t.status === "inbox") : all)
                .length ? (
                <TaskList
                  completedExpanded={status === "completed"}
                  tasks={
                    tab === "inbox"
                      ? all.filter((t) => t.status === "inbox")
                      : all
                  }
                />
              ) : (
                <EmptyState
                  title="A little breathing room"
                  description="Capture a task with only its title. Organize the details later."
                />
              )}
              <QuickCapture />
            </section>
          )}
          {tab === "inbox" && <EmailList />}
        </>
      )}
      {editor && (
        <TaskEditor task={editor.task} onClose={() => setEditor(null)} />
      )}
    </>
  );
}
