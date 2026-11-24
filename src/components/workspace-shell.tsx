"use client";
import { availableProject } from "@/lib/visible-areas";
import { OfflineNotice } from "./offline-notice";
import Link from "next/link";
import { AppLogo, ProfileAvatar } from "./profile-identity";
import { usePathname, useRouter } from "next/navigation";
import type { AcademicData } from "./academic-editor";
import { calendarRequest } from "./use-calendar";
import { useState, useEffect, useMemo } from "react";
import { useTechnicalDetails } from "./technical-details";
import { buildSearchIndex, searchEntries } from "@/lib/search-index";
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
  BookOpen,
  ArrowUpRight,
  LogOut,
  Briefcase,
  GraduationCap,
  NotebookPen,
  Inbox,
  TrendingUp,
  ArrowLeft,
  Trophy,
} from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import { Modal } from "./dialog";
import { TaskEditor } from "./task-editor";
import type { Task } from "@/lib/schemas";
/** Four places to go; everything else lives inside one of them. */
const navigation = [
  { label: "Today", href: "/", icon: Home, also: [] as string[] },
  { label: "Week", href: "/planner", icon: CalendarDays, also: [] },
  {
    label: "School",
    href: "/areas/academics",
    icon: GraduationCap,
    also: [],
  },
  {
    label: "Growth",
    href: "/growth",
    icon: TrendingUp,
    also: [
      "/areas/career",
      "/learning",
      "/areas/projects",
      "/goals",
      "/areas",
      "/basketball",
    ],
  },
];
const allPages = [
  { label: "Today", href: "/", icon: Home },
  { label: "Week planner", href: "/planner", icon: CalendarDays },
  {
    label: "School",
    href: "/areas/academics",
    icon: GraduationCap,
    keywords: "academics courses grades",
  },
  {
    label: "Growth",
    href: "/growth",
    icon: TrendingUp,
    keywords: "goals career learning projects",
  },
  { label: "Career", href: "/areas/career", icon: Briefcase },
  {
    label: "Basketball",
    href: "/basketball",
    icon: Trophy,
    keywords: "mbb games practices team manager",
  },
  { label: "Learning", href: "/learning", icon: NotebookPen },
  { label: "Projects", href: "/areas/projects", icon: Layers3 },
  { label: "Goals", href: "/goals", icon: Target },
  { label: "Reviews", href: "/reviews", icon: BookOpen },
];
export function WorkspaceShell({
  children,
  initialCollapsed = false,
}: {
  children: React.ReactNode;
  initialCollapsed?: boolean;
}) {
  const { data } = useWorkspace();
  const path = usePathname();
  const router = useRouter();
  useTechnicalDetails();
  useEffect(() => {
    const viewport = window.visualViewport;
    const adjust = () => {
      const overlap = viewport
        ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
        : 0;
      document.documentElement.style.setProperty(
        "--keyboard-inset",
        overlap > 120 ? `${overlap}px` : "0px",
      );
    };
    adjust();
    viewport?.addEventListener("resize", adjust);
    viewport?.addEventListener("scroll", adjust);
    return () => {
      viewport?.removeEventListener("resize", adjust);
      viewport?.removeEventListener("scroll", adjust);
      document.documentElement.style.removeProperty("--keyboard-inset");
    };
  }, []);
  const [editor, setEditor] = useState<{ task: Task | null } | null>(null);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [search, setSearch] = useState(false);
  const [query, setQuery] = useState("");
  const [searchAcademic, setSearchAcademic] = useState<AcademicData | null>(
    null,
  );
  const [courseError, setCourseError] = useState(false),
    [courseRetry, setCourseRetry] = useState(0);
  useEffect(() => {
    if (!search || searchAcademic) return;
    let live = true;
    void calendarRequest<AcademicData>("/api/v1/academics")
      .then((d) => {
        if (live) {
          setSearchAcademic(d);
          setCourseError(false);
        }
      })
      .catch(() => {
        if (live) setCourseError(true);
      });
    return () => {
      live = false;
    };
  }, [search, searchAcademic, courseRetry]);
  const index = useMemo(
    () =>
      buildSearchIndex({
        tasks: data.tasks,
        projects: data.projects.filter(availableProject),
        goals: data.goals,
        academic: searchAcademic,
      }),
    [data.tasks, data.projects, data.goals, searchAcademic],
  );
  const results = useMemo(() => searchEntries(index, query), [index, query]);
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
    n.href === "/"
      ? path === "/"
      : path.startsWith(n.href) || n.also.some((a) => path.startsWith(a)),
  );
  // Sub-pages get one clear way back, always in the same place.
  const back =
    active && path !== active.href
      ? { href: active.href, label: active.label }
      : ["/reviews", "/insights"].includes(path) ||
          path.startsWith("/assistant")
        ? { href: "/", label: "Today" }
        : null;
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
              title={n.label}
              aria-label={n.label}
              aria-current={active?.href === n.href ? "page" : undefined}
            >
              <n.icon />
              <span>{n.label}</span>
            </Link>
          ))}
        </nav>
        <nav className="sidebar-utilities" aria-label="Utilities">
          <button
            className="nav-link"
            title="Search"
            onClick={() => setSearch(true)}
          >
            <Search />
            <span>Search</span>
          </button>
          <Link
            className="nav-link"
            href="/planner?section=inbox"
            title="Inbox"
          >
            <Inbox />
            <span>Inbox</span>
            {inbox > 0 && <span className="nav-count">{inbox}</span>}
          </Link>
          <Link
            className={`nav-link ${path === "/reviews" ? "active" : ""}`}
            href="/reviews"
            title="Weekly review"
          >
            <BookOpen />
            <span>Reviews</span>
          </Link>
          <Link
            className={`nav-link ${path === "/insights" ? "active" : ""}`}
            href="/insights"
            title="Insights"
          >
            <ChartNoAxesCombined />
            <span>Insights</span>
          </Link>
        </nav>
        <div className="sidebar-bottom">
          <Link
            href="/settings"
            title="Settings"
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
            onClick={() => {
              setCollapsed(!collapsed);
              try {
                document.cookie = `lifeos_sidebar_collapsed=${!collapsed}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
              } catch {}
            }}
          >
            <PanelLeftClose size={17} />
          </Button>
          <div className="breadcrumb">
            <span>My workspace</span>
            <span className="breadcrumb-slash">/</span>
            <strong>
              {(path.startsWith("/areas/career")
                ? "Career"
                : path.startsWith("/basketball")
                  ? "Basketball"
                  : path.startsWith("/learning")
                    ? "Learning"
                    : path.startsWith("/areas/projects")
                      ? "Projects"
                      : path === "/goals"
                        ? "Goals"
                        : null) ??
                active?.label ??
                (path === "/reviews"
                  ? "Weekly review"
                  : path === "/settings"
                    ? "Settings"
                    : path === "/goals"
                      ? "Goals"
                      : path === "/insights"
                        ? "Insights"
                        : path === "/areas"
                          ? "Workspaces"
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
              Search<kbd>⌘ K</kbd>
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
          {back && (
            <Link href={back.href} className="back-link">
              <ArrowLeft size={16} aria-hidden /> Back to {back.label}
            </Link>
          )}
          {children}
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navigation.slice(0, 2).map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={active?.href === n.href ? "active" : ""}
            aria-current={active?.href === n.href ? "page" : undefined}
          >
            <n.icon />
            {n.label}
          </Link>
        ))}
        <button onClick={() => setEditor({ task: null })}>
          <span className="mobile-add">
            <Plus />
          </span>
          Add
        </button>
        {navigation.slice(2).map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={active?.href === n.href ? "active" : ""}
            aria-current={active?.href === n.href ? "page" : undefined}
          >
            <n.icon />
            {n.label}
          </Link>
        ))}
      </nav>
      {editor && (
        <TaskEditor task={editor.task} onClose={() => setEditor(null)} />
      )}
      <Modal
        open={search}
        onOpenChange={setSearch}
        title="Search"
        description="Find anything and jump straight to it."
      >
        <label className="sr-only" htmlFor="workspace-search">
          Search
        </label>
        {courseError && (
          <p role="status">
            Course search unavailable.{" "}
            <button onClick={() => setCourseRetry((n) => n + 1)}>
              Retry course search
            </button>
          </p>
        )}
        <input
          id="workspace-search"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) {
              e.preventDefault();
              setSearch(false);
              setQuery("");
              router.push(results[0].href);
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              document
                .querySelector<HTMLElement>(".search-results .search-result")
                ?.focus();
            }
          }}
          autoFocus
        />
        <div
          className="search-results"
          onKeyDown={(e) => {
            if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
            const items = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>(".search-result"),
            );
            const index = items.indexOf(document.activeElement as HTMLElement);
            items[
              (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                items.length
            ]?.focus();
            e.preventDefault();
          }}
        >
          {results.map((r) => (
            <Link
              className="search-result"
              href={r.href}
              key={r.kind + r.href + r.title}
              onClick={() => {
                setSearch(false);
                setQuery("");
              }}
            >
              <span className="search-result-text">
                {r.title}
                {r.subtitle && <span className="muted"> · {r.subtitle}</span>}
              </span>
              <small>{r.kind}</small>
            </Link>
          ))}
          {query.trim() && !results.length && (
            <p className="muted small" role="status">
              No results for “{query.trim()}”.
            </p>
          )}
          {!query.trim() && (
            <p className="muted small">
              Search courses, assessments, tasks, goals, projects, study topics
              and settings.
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
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Workspaces</h1>
        </div>
      </div>
      <div className="more-list">
        {allPages.map((n) => (
          <Link key={n.href} href={n.href}>
            <n.icon />
            {n.label}
            <ArrowUpRight size={14} />
          </Link>
        ))}
        <Link href="/insights">
          <ChartNoAxesCombined />
          Insights
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
