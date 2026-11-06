"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import {
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
  Sun,
  Moon,
  Monitor,
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
    <div className={`app-shell density-${data.profile.density}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Main navigation">
        <Link href="/" className="brand">
          <span className="logo">
            <Layers3 size={20} />
          </span>
          Life OS<span className="beta-pill">BETA</span>
        </Link>
        <nav>
          {navigation.map((n) => (
            <Link
              className={`nav-link ${active?.href === n.href ? "active" : ""}`}
              href={n.href}
              key={n.href}
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
          {[...data.areas]
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((a) => (
              <Link className="area-link" href={`/areas/${a.slug}`} key={a.id}>
                <span className="area-dot" style={{ background: a.color }} />
                {a.name}
              </Link>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <Link href="/reviews" className="nav-link">
            <BookOpen />
            <span>Weekly review</span>
          </Link>
          <Link
            href="/settings"
            className={`nav-link ${path === "/settings" ? "active" : ""}`}
          >
            <Settings />
            <span>Settings</span>
          </Link>
          <div className="beta-notice">
            <strong>
              <ShieldCheck size={13} />
              Your private beta
            </strong>
            <p>Test data only. Calendar writes and automation are off.</p>
          </div>
          <Link href="/settings" className="account">
            <div className="avatar">
              {data.profile.display_name?.slice(0, 2).toUpperCase() || "ME"}
            </div>
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
              Search anything<kbd>⌘ K</kbd>
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
          {children}
          <div className="footer-note">
            <ShieldCheck size={11} />
            Private beta · Test data only · America/Vancouver
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
            ["/goals", "/insights", "/more", "/settings", "/reviews"].includes(
              path,
            )
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
          placeholder="Search your workspace…"
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
              .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
              .slice(0, 6)
              .map((p) => (
                <Link
                  className="search-result"
                  href="/areas/projects"
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
                  href="/goals"
                  key={g.id}
                  onClick={() => setSearch(false)}
                >
                  {g.title}
                  <small>Goal</small>
                </Link>
              ))}
          {!query.trim() && (
            <p className="muted small">
              Start typing to search your recorded data.
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
export function MorePage() {
  const router = useRouter();
  const { request, notify } = useWorkspace();
  const { setTheme } = useTheme();
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
      <div className="panel settings-panel" style={{ marginTop: 20 }}>
        <h2>Appearance</h2>
        <div className="inline" style={{ marginTop: 15 }}>
          <Button variant="outline" onClick={() => setTheme("light")}>
            <Sun size={15} />
            Light
          </Button>
          <Button variant="outline" onClick={() => setTheme("dark")}>
            <Moon size={15} />
            Dark
          </Button>
          <Button variant="outline" onClick={() => setTheme("system")}>
            <Monitor size={15} />
            System
          </Button>
        </div>
        <p className="form-hint" style={{ marginTop: 10 }}>
          Save your account preference in Settings.
        </p>
      </div>
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
