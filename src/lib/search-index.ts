/**
 * One ranked search over everything in Life OS. Each entry links straight to
 * the place that shows it (the course and assessment, the goal card, the
 * settings section), so a result is always one tap from what you meant.
 */
export type SearchEntry = {
  kind: string;
  title: string;
  subtitle?: string;
  href: string;
  keywords?: string;
};

type Row = Record<string, unknown>;
export type SearchSources = {
  tasks: {
    id: string;
    title: string;
    status: string;
    deleted_at?: string | null;
  }[];
  projects: { id: string; name: string; status?: string }[];
  goals: { id: string; title: string; status: string }[];
  academic?: {
    courses: Row[];
    assessments: Row[];
    study_topics: Row[];
  } | null;
};

const PAGES: SearchEntry[] = [
  { kind: "Page", title: "Today", href: "/", keywords: "home dashboard next" },
  {
    kind: "Page",
    title: "Week planner",
    href: "/planner",
    keywords: "planner calendar schedule agenda",
  },
  {
    kind: "Page",
    title: "Tasks",
    href: "/planner?section=tasks",
    keywords: "to do todo",
  },
  { kind: "Page", title: "Inbox", href: "/planner?section=inbox" },
  {
    kind: "Page",
    title: "Recurring tasks",
    href: "/planner?section=recurring",
  },
  {
    kind: "Page",
    title: "Scheduling preview",
    href: "/planner?section=scheduling",
    keywords: "work blocks auto schedule",
  },
  {
    kind: "Page",
    title: "School",
    href: "/areas/academics",
    keywords: "academics courses classes",
  },
  {
    kind: "Page",
    title: "Assessments",
    href: "/areas/academics?view=assessments",
    keywords: "assignments exams quizzes deadlines",
  },
  {
    kind: "Page",
    title: "Grades",
    href: "/areas/academics?view=grades",
    keywords: "marks results gpa",
  },
  {
    kind: "Page",
    title: "Course materials",
    href: "/areas/academics?view=materials",
    keywords: "readings slides files syllabus",
  },
  {
    kind: "Page",
    title: "Study",
    href: "/areas/academics?view=study",
    keywords: "topics study log",
  },
  {
    kind: "Page",
    title: "Growth",
    href: "/growth",
    keywords: "goals career learning",
  },
  {
    kind: "Page",
    title: "Career",
    href: "/areas/career",
    keywords: "roadmap internships applications contacts",
  },
  {
    kind: "Page",
    title: "Learning",
    href: "/learning",
    keywords: "skills courses",
  },
  { kind: "Page", title: "Projects", href: "/areas/projects" },
  { kind: "Page", title: "Goals", href: "/goals" },
  {
    kind: "Page",
    title: "Weekly review",
    href: "/reviews",
    keywords: "reflection",
  },
  {
    kind: "Page",
    title: "Insights",
    href: "/insights",
    keywords: "stats trends",
  },
  {
    kind: "Settings",
    title: "Preferences",
    href: "/settings?section=profile",
    keywords: "theme dark light name picture timezone",
  },
  {
    kind: "Settings",
    title: "Connections",
    href: "/settings?section=integrations",
    keywords: "google calendar canvas sheets sync reconnect",
  },
  {
    kind: "Settings",
    title: "Privacy & account",
    href: "/settings?section=privacy",
    keywords: "password mfa security delete export notifications",
  },
  {
    kind: "Settings",
    title: "Advanced",
    href: "/settings?section=advanced",
    keywords: "reset",
  },
];

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function buildSearchIndex(src: SearchSources): SearchEntry[] {
  const out: SearchEntry[] = [...PAGES];
  const courseCode = new Map<string, string>();
  for (const c of src.academic?.courses ?? []) {
    const id = str(c.id);
    courseCode.set(id, str(c.code));
    out.push({
      kind: "Course",
      title: `${str(c.code)} · ${str(c.title)}`,
      href: `/areas/academics?course=${id}`,
    });
  }
  for (const a of src.academic?.assessments ?? []) {
    if (a.dropped) continue;
    out.push({
      kind: "Assessment",
      title: str(a.title),
      subtitle: courseCode.get(str(a.course_id)),
      href: `/areas/academics?course=${str(a.course_id)}&assessment=${str(a.id)}`,
      keywords: "assignment",
    });
  }
  for (const t of src.academic?.study_topics ?? [])
    out.push({
      kind: "Study topic",
      title: str(t.title),
      subtitle: courseCode.get(str(t.course_id)),
      href: `/areas/academics?course=${str(t.course_id)}&view=study`,
    });
  for (const t of src.tasks)
    if (!t.deleted_at)
      out.push({
        kind: t.status === "completed" ? "Done task" : "Task",
        title: t.title,
        href: `/planner?section=tasks&task=${t.id}`,
      });
  for (const p of src.projects)
    out.push({
      kind: "Project",
      title: p.name,
      href: `/areas/projects#project-${p.id}`,
    });
  for (const g of src.goals)
    out.push({ kind: "Goal", title: g.title, href: `/goals#goal-${g.id}` });
  return out;
}

const norm = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/**
 * Every word of the query must appear somewhere in the entry. Titles that
 * start with the query rank first, then word starts, then any match.
 */
export function searchEntries(index: SearchEntry[], query: string, limit = 24) {
  const q = norm(query.trim());
  if (!q) return [];
  const words = q.split(/\s+/);
  const scored: { e: SearchEntry; score: number }[] = [];
  for (const e of index) {
    const title = norm(e.title);
    const hay = `${title} ${norm(e.subtitle ?? "")} ${norm(e.kind)} ${norm(e.keywords ?? "")}`;
    if (!words.every((w) => hay.includes(w))) continue;
    let score = 0;
    if (title === q) score += 100;
    else if (title.startsWith(q)) score += 60;
    else if (
      new RegExp(
        `(^|[^a-z0-9])${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ).test(title)
    )
      score += 40;
    else if (title.includes(q)) score += 25;
    for (const w of words)
      if (title.startsWith(w)) score += 10;
      else if (title.split(/[^a-z0-9]+/).some((t) => t.startsWith(w)))
        score += 6;
      else if (title.includes(w)) score += 3;
    if (e.kind === "Page" || e.kind === "Settings") score += 3;
    if (e.kind === "Done task") score -= 10;
    scored.push({ e, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.e.title.localeCompare(b.e.title))
    .slice(0, limit)
    .map((s) => s.e);
}
