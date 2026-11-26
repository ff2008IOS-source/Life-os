"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { visibleArea } from "@/lib/visible-areas";
import { realWorkspace } from "@/lib/real-workspace";
import { useCallback, useEffect, useState } from "react";
import {
  addDays,
  addMonths,
  startOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  format,
} from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { Inbox, Plus } from "lucide-react";
import { Button } from "./ui/button";
import { CanvasDeadlines } from "./canvas-deadlines";
import { useWorkspace } from "./workspace-provider";
import { TaskList, EmptyState, QuickCapture } from "./task-list";
import { TaskEditor, taskValues } from "./task-editor";
import { localDate } from "@/lib/dates";
import type { Task } from "@/lib/schemas";
import { PlannerCalendar } from "./planner-calendar";
import { usePreference } from "./use-preference";
export function PlannerPage({
  initialSection,
}: { initialSection?: string } = {}) {
  const { data: raw, mutate, notify } = useWorkspace();
  const data = realWorkspace(raw);
  const selectedTask = useSearchParams().get("task");
  const router = useRouter();
  // Work hours, sessions and recurring tasks now live in Settings → Planning.
  const moved = initialSection === "recurring" || initialSection === "schedule";
  useEffect(() => {
    if (moved) router.replace("/settings?section=planning");
  }, [moved, router]);
  const [tab, setTab] = useState(
    ["calendar", "tasks", "inbox"].includes(initialSection ?? "")
      ? initialSection!
      : "calendar",
  );
  // Saved to the account; first visit picks Day on a phone, Week otherwise.
  const [savedView, saveView] = usePreference<string | null>(
    "calendar_view",
    null,
  );
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(max-width: 700px)");
    const update = () => setPhone(q.matches);
    queueMicrotask(update);
    q.addEventListener("change", update);
    return () => q.removeEventListener("change", update);
  }, []);
  const view = savedView ?? (phone ? "day" : "week");
  const setView = useCallback((next: string) => saveView(next), [saveView]);
  const [anchor, setAnchor] = useState(
    () => new Date(localDate() + "T12:00:00"),
  );
  const [area, setArea] = useState("");
  const [status, setStatus] = useState("active");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<{
    task: Task | null;
    dueAt?: string;
  } | null>(() => {
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
  const navigate = useCallback(
    (direction: number) =>
      setAnchor((a) =>
        view === "month"
          ? addMonths(a, direction)
          : addDays(a, direction * (view === "week" ? 7 : 1)),
      ),
    [view],
  );
  const goToday = useCallback(
    () => setAnchor(new Date(localDate() + "T12:00:00")),
    [],
  );
  /** A task dragged to another day keeps its time, if it has one. */
  async function moveTask(task: Task, day: string) {
    const due_at = task.due_at
      ? fromZonedTime(
          `${day}T${formatInTimeZone(task.due_at, "America/Vancouver", "HH:mm")}:00`,
          "America/Vancouver",
        ).toISOString()
      : null;
    try {
      await mutate(
        "tasks",
        task.id,
        { ...taskValues(task), due_at, due_date: due_at ? null : day },
        task.version,
      );
      notify(`Moved to ${format(new Date(day + "T12:00:00"), "EEE, MMM d")}`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn’t move that task.");
    }
  }
  if (moved) return null;
  return (
    <>
      <h1 className="sr-only">Week</h1>
      <div
        className="tabs planner-tabs"
        role="tablist"
        aria-label="Planner section"
      >
        {[
          { id: "calendar", label: "Calendar" },
          { id: "tasks", label: `Tasks · ${all.length}` },
          {
            id: "inbox",
            label: `Inbox · ${data.tasks.filter((t) => !t.deleted_at && t.status === "inbox").length}`,
          },
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
      {
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
              onNavigate={navigate}
              onToday={goToday}
              onView={setView}
              onNewTask={(dueAt) => setEditor({ task: null, dueAt })}
              onMoveTask={moveTask}
            />
          ) : (
            <section className="panel">
              <div className="panel-heading">
                <div className="panel-title">
                  <Inbox />
                  <h2>{tab === "inbox" ? "Your inbox" : "Your tasks"}</h2>
                </div>
                <Button size="sm" onClick={() => setEditor({ task: null })}>
                  <Plus size={14} /> New task
                </Button>
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
          {tab === "tasks" && <CanvasDeadlines />}
        </>
      }
      {editor && (
        <TaskEditor
          task={editor.task}
          defaultDueAt={editor.dueAt}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  );
}
