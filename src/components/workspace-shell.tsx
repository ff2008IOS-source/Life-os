"use client";
import { visibleArea, availableProject } from "@/lib/visible-areas";
import { OfflineNotice } from "./offline-notice";
import Link from "next/link";
import { AppLogo, ProfileAvatar } from "./profile-identity";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import {
  PanelLeftClose,
  Home,
  CalendarDays,
  Layers3,
  Target,
  ChartNoAxesCombined,
  Plus,
  Search,
  Settings,
  ChevronDown,
  ShieldCheck,
  MoreHorizontal,
  BookOpen,
  ArrowUpRight,
  LogOut,
} from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import { Modal } from "./dialog";
import { TaskEditor } from "./task-editor";
import type { Task } from "@/lib/schemas";
const navigation = [
  { label: "Home", href: "/", icon: Home },
  { label: "Planner", href: "/planner", icon: CalendarDays },
  { label: "Life Areas", href: "/areas", icon: Layers3 },
  { label: "Goals", href: "/goals", icon: Target },
  { label: "Insights", href: "/insights", icon: ChartNoAxesCombined },
];
export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const { data } = useWorkspace();
  const path = usePathname();
  const [editor, setEditor] = useState<{ task: Task | null } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState(false);
  const [query, setQuery] = useState("");
  const { setTheme } = useTheme();
  useEffect(() => {
    setTheme(data.profile.theme);
  }, [data.profile.theme, setTheme]);
  useEffect(() => {
    function shortcut(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch((v) => !v);
      }
    }
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  const active = navigation.find((n) =>
    n.href === "/" ? path === "/" : path.startsWith(n.href),
  );
  const inbox = data.tasks.filter(
    (t) => !t.deleted_at && t.status === "inbox",
  ).length;

  return (
    <div
      className={`app-shell density-${data.profile.density} ${collapsed ? "sidebar-collapsed" : ""}`}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Main navigation">
        <Link href="/" className="brand">
          <span className="logo">
            <AppLogo />
          </span>
          Life OS
        </Link>
        <nav>
          {navigation.map((n) => (
            <Link
              className={`nav-link ${active?.href === n.href ? "active" : ""}`}
              href={n.href}
              key={n.href}
              aria-label={n.label}
              aria-current={active?.href === n.href ? "page" : undefined}
            >
              <n.icon />
              <span>{n.label}</span>
              {n.href === "/planner" && inbox > 0 && (
                <span className="nav-count">{inbox}</span>
              )}
            </Link>
          ))}
        </nav>
        <p className="sidebar-label">YOUR LIFE AREAS</p>
        <nav aria-label="Life areas">
          {data.areas
            .filter(visibleArea)
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((a) => (
              <Link className="area-link" href={`/areas/${a.slug}`} key={a.id}>
                <span className="area-dot" style={{ background: a.color }} />
                {a.name}
              </Link>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <Link href="/reviews" className="nav-link" aria-label="Weekly review">
            <BookOpen />
            <span>Weekly review</span>
          </Link>
          <Link
            href="/settings"
            aria-label="Settings"
            className={`nav-link ${path === "/settings" ? "active" : ""}`}
          >
            <Settings />
            <span>Settings</span>
          </Link>
          <Link href="/settings" className="account">
            <ProfileAvatar />
            <div>
              <strong>{data.profile.display_name || "Your workspace"}</strong>
              <p>Personal account</p>
            </div>
            <ChevronDown size={12} className="muted" />
          </Link>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <Button
            className="sidebar-toggle"
            variant="ghost"
            size="icon"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            <PanelLeftClose size={17} />
          </Button>
          <div className="breadcrumb">
            <span>My workspace</span>
            <span className="breadcrumb-slash">/</span>
            <strong>
              {active?.label ??
                (path === "/reviews"
                  ? "Weekly review"
                  : path === "/settings"
                    ? "Settings"
                    : "More")}
            </strong>
          </div>
          <div className="top-actions">
            <button
              className="search-trigger"
              onClick={() => setSearch(true)}
              aria-label="Search workspace"
            >
              <Search size={15} />
              Find tasks & goals<kbd>⌘ K</kbd>
            </button>
            <span className="top-divider" />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Account settings"
              asChild
            >
              <Link href="/settings">
                <Settings size={17} />
              </Link>
            </Button>
            <Button onClick={() => setEditor({ task: null })}>
              <Plus size={15} />
              Quick add
            </Button>
          </div>
        </header>
        <main className="content" id="main-content">
          <OfflineNotice />
          {children}
          <div className="footer-note">
            <ShieldCheck size={11} />
            Your space. Your pace.
          </div>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        <Link href="/" className={path === "/" ? "active" : ""}>
          <Home />
          Home
        </Link>
        <Link href="/planner" className={path === "/planner" ? "active" : ""}>
          <CalendarDays />
          Planner
        </Link>
        <button onClick={() => setEditor({ task: null })}>
          <span className="mobile-add">
            <Plus />
          </span>
          Add
        </button>
        <Link
          href="/areas"
          className={path.startsWith("/areas") ? "active" : ""}
        >
          <Layers3 />
          Life Areas
        </Link>
        <Link
          href="/more"
          className={
            [
              "/goals",
              "/assistant/history",
              "/briefing",
              "/insights",
              "/more",
              "/settings",
              "/reviews",
            ].includes(path)
              ? "active"
              : ""
          }
        >
          <MoreHorizontal />
          More
        </Link>
      </nav>
      {editor && (
        <TaskEditor task={editor.task} onClose={() => setEditor(null)} />
      )}
      <Modal
        open={search}
        onOpenChange={setSearch}
        title="Find your next step"
        description="Search tasks, projects, and goals in your workspace."
      >
        <label className="sr-only" htmlFor="workspace-search">
          Search
        </label>
        <input
          id="workspace-search"
          placeholder="Search tasks, projects or goals…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <div className="search-results">
          {query.trim() &&
            data.tasks
              .filter(
                (t) =>
                  !t.deleted_at &&
                  t.title.toLowerCase().includes(query.toLowerCase()),
              )
              .slice(0, 12)
              .map((t) => (
                <button
                  className="search-result"
                  key={t.id}
                  onClick={() => {
                    setSearch(false);
                    setEditor({ task: t });
                  }}
                >
                  {t.title}
                  <small>Task · {t.status.replaceAll("_", " ")}</small>
                </button>
              ))}
          {query.trim() &&
            data.projects
              .filter(availableProject)
              .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
              .slice(0, 6)
              .map((p) => (
                <Link
                  className="search-result"
                  href={`/areas/projects#project-${p.id}`}
                  key={p.id}
                  onClick={() => setSearch(false)}
                >
                  {p.name}
                  <small>Project</small>
                </Link>
              ))}
          {query.trim() &&
            data.goals
              .filter((g) =>
                g.title.toLowerCase().includes(query.toLowerCase()),
              )
              .slice(0, 6)
              .map((g) => (
                <Link
                  className="search-result"
                  href={`/goals#goal-${g.id}`}
                  key={g.id}
                  onClick={() => setSearch(false)}
                >
                  {g.title}
                  <small>Goal</small>
                </Link>
              ))}
          {query.trim() &&
            ![
              ...data.tasks.filter((t) => !t.deleted_at).map((t) => t.title),
              ...data.projects.map((p) => p.name),
              ...data.goals.map((g) => g.title),
            ].some((title) =>
              title.toLowerCase().includes(query.toLowerCase()),
            ) && (
              <p className="muted small" role="status">
                No matching tasks, projects or goals. Course materials and
                source records are available in their own sections.
              </p>
            )}
          {!query.trim() && (
            <p className="muted small">Find a task, project or goal.</p>
          )}
        </div>
      </Modal>
    </div>
  );
}
export function MorePage() {
  const router = useRouter();
  const { request, notify } = useWorkspace();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR WORKSPACE</span>
          <h1>A little more</h1>
          <p>Your goals, progress, and preferences.</p>
        </div>
      </div>
      <div className="more-list">
        <Link href="/goals">
          <Target />
          Goals
          <ArrowUpRight size={14} />
        </Link>
        <Link href="/insights">
          <ChartNoAxesCombined />
          Insights
          <ArrowUpRight size={14} />
        </Link>
        <Link href="/reviews">
          <BookOpen />
          Weekly reviews
          <ArrowUpRight size={14} />
        </Link>
        <Link href="/settings">
          <Settings />
          Settings & integrations
          <ArrowUpRight size={14} />
        </Link>
      </div>
      <Link className="text-link" href="/settings?section=profile">
        Appearance & preferences <ArrowUpRight size={14} />
      </Link>
      <Button
        variant="ghost"
        style={{ marginTop: 20 }}
        onClick={async () => {
          try {
            await request("/api/v1/auth/logout", { method: "POST" });
            router.push("/login");
            router.refresh();
          } catch (e) {
            notify(e instanceof Error ? e.message : "Unable to sign out");
          }
        }}
      >
        <LogOut size={15} />
        Sign out
      </Button>
    </>
  );
}
