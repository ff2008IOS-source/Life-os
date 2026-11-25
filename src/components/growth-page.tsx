"use client";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import {
  ArrowRight,
  BookOpen,
  Briefcase,
  ChartNoAxesCombined,
  Layers3,
  NotebookPen,
  Target,
} from "lucide-react";
import { realWorkspace } from "@/lib/real-workspace";
import { reviewAvailability } from "@/lib/temporal-context";
import { useWorkspace } from "./workspace-provider";
import { useCurrentTime } from "./use-current-time";
import { CareerFollowUps } from "./career-follow-ups";

export function GrowthPage() {
  const { data: raw } = useWorkspace();
  const data = realWorkspace(raw);
  const now = useCurrentTime();
  const zone = data.profile.timezone || "America/Vancouver";
  const today = formatInTimeZone(now, zone, "yyyy-MM-dd");
  const open = (status: string) => !["completed", "cancelled"].includes(status);
  const goals = data.goals
    .filter((g) => g.status === "active" && !g.is_example)
    .map((g) => {
      const next = data.goalTasks
        .filter((l) => l.goal_id === g.id)
        .map((l) => data.tasks.find((t) => t.id === l.task_id))
        .find((t) => t && !t.deleted_at && open(t.status));
      const late = !!g.target_date && g.target_date < today;
      return { g, next, late };
    })
    .sort(
      (a, b) =>
        Number(b.late) - Number(a.late) ||
        Number(!b.next) - Number(!a.next) ||
        (a.g.target_date ?? "9999").localeCompare(b.g.target_date ?? "9999"),
    );
  const area = (id: string | null) => data.areas.find((a) => a.id === id)?.name;
  const projects = data.projects.filter(
    (p) => p.status === "active" && !p.deleted_at && !p.archived_at,
  );
  const review = reviewAvailability(now, zone);
  const stuck = goals.filter((x) => x.late || !x.next).length;
  const tiles = [
    {
      href: "/areas/career",
      icon: Briefcase,
      title: "Career",
      text: "Roadmap, applications and contacts",
    },
    {
      href: "/learning",
      icon: NotebookPen,
      title: "Learning",
      text: "Skill paths and study topics",
    },
    {
      href: "/areas/projects",
      icon: Layers3,
      title: "Projects",
      text: `${projects.length} active`,
    },
    {
      href: "/reviews",
      icon: BookOpen,
      title: "Weekly review",
      text: review.open ? "Open now" : "Opens Sunday",
    },
    {
      href: "/insights",
      icon: ChartNoAxesCombined,
      title: "Insights",
      text: "Trends across your weeks",
    },
  ];
  const date = (d: string) =>
    formatInTimeZone(new Date(d + "T12:00:00Z"), "UTC", "MMM d");
  return (
    <div className="td">
      <header className="td-header">
        <p className="td-eyebrow">GROWTH</p>
        <h1>Where you’re headed</h1>
        <p className="td-summary">
          {goals.length} active goal{goals.length === 1 ? "" : "s"}
          {stuck
            ? ` · ${stuck} need${stuck === 1 ? "s" : ""} a next step or a new date`
            : " · all moving"}
        </p>
      </header>
      <div className="td-grid">
        <section className="td-card" aria-label="Goals">
          <div className="td-card-head">
            <h2 className="td-card-title">Goals</h2>
            <Link href="/goals" className="td-link">
              Edit goals <ArrowRight size={14} aria-hidden />
            </Link>
          </div>
          {goals.length === 0 && (
            <p className="td-muted">
              No active goals yet. <Link href="/goals">Add one</Link> to see it
              here.
            </p>
          )}
          <ul className="td-due">
            {goals.map(({ g, next, late }) => (
              <li key={g.id}>
                <Link href="/goals">
                  <span className={`td-badge ${late ? "td-badge-hot" : ""}`}>
                    <Target size={16} aria-hidden />
                    <small>{g.target_date ? date(g.target_date) : "—"}</small>
                  </span>
                  <span className="td-due-text">
                    <strong>{g.title}</strong>
                    <span>
                      {[area(g.area_id), late ? "past target date" : null]
                        .filter(Boolean)
                        .join(" · ")}
                      {area(g.area_id) || late ? " · " : ""}
                      {next ? `Next: ${next.title}` : "No next step yet"}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <CareerFollowUps />
        <nav className="td-tiles" aria-label="Growth areas">
          {tiles.map((t) => (
            <Link key={t.href} href={t.href} className="td-tile">
              <span className="td-tile-icon" aria-hidden>
                <t.icon size={18} />
              </span>
              <span>
                <strong>{t.title}</strong>
                <span>{t.text}</span>
              </span>
              <ArrowRight size={16} aria-hidden />
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
