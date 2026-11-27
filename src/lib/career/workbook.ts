/**
 * Reads the Google Sheets career dashboard into Life OS records. Pure: the
 * caller supplies the workbook values (from the Sheets API or a saved
 * snapshot) and gets records with stable keys, so an import can be re-run
 * without duplicates. Nothing here writes anywhere.
 *
 * Sections are found by their header row, not by fixed positions, so a
 * moved table still reads correctly. Text that isn't a date stays text:
 * "Follow up when available; Nov 3 target passed" is a note, not a date.
 */
export type Cell = string | number | boolean | null;
export type Tab = { id: number; title: string; values: Cell[][] };
export type Workbook = { tabs: Tab[] };

export const TABS = [
  "Dashboard",
  "4-Year Roadmap",
  "Semester Plan",
  "Weekly Review",
  "Network & Applications",
  "Skills & Portfolio",
  "Calendar Playbook",
  "Course Command Centre",
  "Assessments & Grades",
  "Knowledge Mastery",
  "Internship & Co-op Roadmap",
] as const;
export type TabName = (typeof TABS)[number];

export type CareerKind =
  | "application_target"
  | "application"
  | "skill"
  | "portfolio_project"
  | "career_goal"
  | "roadmap"
  | "coop_term"
  | "reference";

export type ImportRecord =
  | {
      table: "career_entries";
      tab: TabName;
      key: string;
      kind: CareerKind;
      title: string;
      status: string;
      due_date: string | null;
      details: Record<string, unknown>;
      sort_order: number;
    }
  | {
      table: "contacts";
      tab: TabName;
      key: string;
      name: string;
      organization: string | null;
      role: string | null;
      how_met: string | null;
      relationship_notes: string | null;
      last_contact_at: string | null;
      next_follow_up_date: string | null;
    }
  | {
      table: "reviews";
      tab: TabName;
      key: string;
      period_start: string;
      period_end: string;
      achievements: string;
      obstacles: string;
      priorities: string;
      conversation_summary: string;
      details: Record<string, unknown>;
    };

export type Skipped = { tab: TabName; row: string; reason: string };

const text = (c: Cell | undefined) =>
  c === null || c === undefined ? "" : String(c).trim();
export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A date from the workbook, or null. Dates without a year belong to the
 * 2026–27 school year the workbook covers: August–December is 2026,
 * January–July is 2027.
 */
export function sheetDate(value: Cell | undefined): string | null {
  const s = text(value);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(
    /^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/i,
  );
  if (!m) return null;
  const mo = MONTHS[m[1].toLowerCase()];
  const d = Number(m[2]);
  if (!mo || d < 1 || d > 31) return null;
  const y = m[3] ? Number(m[3]) : mo >= 8 ? 2026 : 2027;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

function addDays(iso: string, n: number) {
  const t = new Date(iso + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Row index of the header containing every label (trimmed). */
function headerRow(tab: Tab, labels: string[], after = -1) {
  for (let i = after + 1; i < tab.values.length; i++) {
    const row = tab.values[i].map(text);
    if (labels.every((l) => row.includes(l))) return i;
  }
  return -1;
}

const section = (row: string[]) =>
  /^[A-Z][A-Z &·:,0-9\-—]{3,}$/.test(row[0]) &&
  row.filter(Boolean).length === 1;

/** Rows of a table under a header, until a blank row or the next section. */
function tableRows(
  tab: Tab,
  header: number,
  stop?: (row: string[]) => boolean,
) {
  const heads = tab.values[header].map(text);
  const rows: { at: number; get: (h: string) => string }[] = [];
  for (let i = header + 1; i < tab.values.length; i++) {
    const row = tab.values[i].map(text);
    if (!row.some(Boolean)) {
      // One blank row ends a table unless more rows follow straight after.
      if (!(tab.values[i + 1] ?? []).map(text).some(Boolean)) break;
      continue;
    }
    if (section(row) || stop?.(row)) break;
    rows.push({
      at: i + 1,
      get: (h: string) => {
        const c = heads.indexOf(h);
        return c < 0 ? "" : (row[c] ?? "");
      },
    });
  }
  return rows;
}

const tabOf = (wb: Workbook, name: TabName) =>
  wb.tabs.find((t) => t.title === name);

/** Normalised status; the workbook's own wording stays in details. */
export function statusOf(raw: string) {
  const s = raw.toLowerCase();
  if (!s) return "unknown";
  if (/^complete|^done|^submitted/.test(s)) return "Complete";
  if (/not completed|not started/.test(s)) return "Not Started";
  if (/in progress|on track|active/.test(s)) return "In Progress";
  if (/research/.test(s)) return "Research";
  return raw.slice(0, 60);
}

export function readWorkbook(wb: Workbook) {
  const records: ImportRecord[] = [];
  const skipped: Skipped[] = [];
  const missing: TabName[] = [];
  const need = (name: TabName) => {
    const t = tabOf(wb, name);
    if (!t) missing.push(name);
    return t;
  };

  // Network & Applications: contacts on top, applications below.
  const net = need("Network & Applications");
  if (net) {
    const h = headerRow(net, ["Name", "Organization", "Role"]);
    for (const r of h < 0 ? [] : tableRows(net, h, section)) {
      const name = r.get("Name");
      if (!name) continue;
      const last = r.get("Last Contact");
      const next = r.get("Next Follow-Up");
      const by = r.get("Follow-up by");
      const notes = [
        last && !sheetDate(last) ? `Last contact: ${last}` : "",
        next && !sheetDate(next) ? `Next follow-up: ${next}` : "",
        by && !sheetDate(by) ? `Follow-up by: ${by}` : "",
      ].filter(Boolean);
      records.push({
        table: "contacts",
        tab: "Network & Applications",
        key: `wb:contact:${norm(name)}`,
        name,
        organization: r.get("Organization") || null,
        role: r.get("Role") || null,
        how_met: r.get("How We Met") || null,
        relationship_notes: notes.join("\n") || null,
        last_contact_at: sheetDate(last),
        next_follow_up_date: sheetDate(next) ?? sheetDate(by),
      });
    }
    const a = headerRow(net, ["Organization / Role", "Status"]);
    tableRows(net, a < 0 ? net.values.length : a, section).forEach((r, i) => {
      const title = r.get("Organization / Role");
      if (!title) return;
      const stage = r.get("Stage");
      // A target employer is not an application.
      const target = /target/i.test(stage) || /\(target/i.test(title);
      records.push({
        table: "career_entries",
        tab: "Network & Applications",
        key: `wb:${target ? "employer" : "application"}:${norm(title)}`,
        kind: target ? "application_target" : "application",
        title,
        status: r.get("Status") || (target ? "Research" : "unknown"),
        due_date: sheetDate(r.get("Deadline")),
        details: {
          type: r.get("Type") || null,
          stage: stage || null,
          deadline_text: r.get("Deadline") || null,
        },
        sort_order: i,
      });
    });
  }

  // Skills & Portfolio.
  const sp = need("Skills & Portfolio");
  if (sp) {
    const h = headerRow(sp, ["Skill", "Current Level"]);
    tableRows(sp, h < 0 ? sp.values.length : h, section).forEach((r, i) => {
      const skill = r.get("Skill");
      if (!skill) return;
      const evidence = r.get("Evidence");
      records.push({
        table: "career_entries",
        tab: "Skills & Portfolio",
        key: `wb:skill:${norm(skill)}`,
        kind: "skill",
        title: skill,
        status: statusOf(r.get("Status")),
        due_date: null,
        details: {
          level: r.get("Current Level") || null,
          target: r.get("Year Target") || null,
          rhythm: r.get("Practice Rhythm") || null,
          status_text: r.get("Status") || null,
          evidence: evidence
            ? [{ date: null, text: evidence, source: "workbook" }]
            : [],
        },
        sort_order: i,
      });
    });
    const p = headerRow(sp, ["Project", "Target Date"]);
    tableRows(sp, p < 0 ? sp.values.length : p, section).forEach((r, i) => {
      const project = r.get("Project");
      if (!project) return;
      // "Milestone 2 — …" keeps one identity even if its wording changes.
      const milestone = project.match(/^milestone\s*(\d+)/i);
      records.push({
        table: "career_entries",
        tab: "Skills & Portfolio",
        key: milestone
          ? `wb:portfolio:milestone-${milestone[1]}`
          : `wb:portfolio:${norm(project)}`,
        kind: "portfolio_project",
        title: project,
        status: statusOf(r.get("Status")),
        due_date: sheetDate(r.get("Target Date")),
        details: {
          next_step: r.get("Next step") || null,
          area: r.get("Area") || null,
          status_text: r.get("Status") || null,
          target_text: r.get("Target Date") || null,
        },
        sort_order: i,
      });
    });
  }

  // Semester Plan.
  const sem = need("Semester Plan");
  if (sem) {
    const h = headerRow(sem, ["Semester", "Area", "Goal"]);
    tableRows(sem, h < 0 ? sem.values.length : h).forEach((r, i) => {
      const goal = r.get("Goal");
      if (!goal) return;
      records.push({
        table: "career_entries",
        tab: "Semester Plan",
        key: `wb:semester:${norm(r.get("Semester"))}:${norm(r.get("Area"))}:${norm(goal)}`,
        kind: "career_goal",
        title: goal,
        status: statusOf(r.get("Status")),
        due_date: sheetDate(r.get("Deadline")),
        details: {
          semester: r.get("Semester") || null,
          area: r.get("Area") || null,
          metric: r.get("Metric") || null,
          priority: r.get("Priority") || null,
          next_action: r.get("Next Action") || null,
          evidence: r.get("Evidence") || null,
          notes: r.get("Notes") || null,
        },
        sort_order: i,
      });
    });
  }

  // 4-Year Roadmap.
  const road = need("4-Year Roadmap");
  if (road) {
    const h = headerRow(road, ["Year", "Mission"]);
    tableRows(road, h < 0 ? road.values.length : h).forEach((r, i) => {
      const year = r.get("Year");
      if (!year) return;
      records.push({
        table: "career_entries",
        tab: "4-Year Roadmap",
        key: `wb:year:${norm(year)}`,
        kind: "roadmap",
        title: `${year}: ${r.get("Mission")}`.slice(0, 300),
        status: "unknown",
        due_date: null,
        details: {
          year,
          mission: r.get("Mission") || null,
          academics: r.get("Academics") || null,
          basketball: r.get("Basketball") || null,
          career_skills: r.get("Career Skills") || null,
          experience: r.get("Experience") || null,
          networking: r.get("Networking") || null,
          portfolio: r.get("Portfolio") || null,
          success_test: r.get("Success Test") || null,
        },
        sort_order: i,
      });
    });
  }

  // Internship & Co-op Roadmap.
  const coop = need("Internship & Co-op Roadmap");
  if (coop) {
    const h = headerRow(coop, ["Term", "Primary Objective"]);
    tableRows(coop, h < 0 ? coop.values.length : h).forEach((r, i) => {
      const term = r.get("Term");
      if (!term) return;
      records.push({
        table: "career_entries",
        tab: "Internship & Co-op Roadmap",
        key: `wb:coop:${norm(term)}`,
        kind: "coop_term",
        title: `${term}: ${r.get("Primary Objective")}`.slice(0, 300),
        status: statusOf(r.get("Status")),
        due_date: null,
        details: {
          term,
          objective: r.get("Primary Objective") || null,
          target_roles: r.get("Target Roles / Experience") || null,
          realistic_outcome: r.get("Realistic Outcome") || null,
          skills_needed: r.get("Skills Needed Before Applying") || null,
          application_window: r.get("Application Window") || null,
          priority: r.get("Priority") || null,
          graduation_impact: r.get("Graduation Impact") || null,
          success_metric: r.get("Success Metric") || null,
          notes: r.get("Notes") || null,
        },
        sort_order: i,
      });
    });
  }

  // Weekly Review: one review per week that has any content.
  const wr = need("Weekly Review");
  if (wr) {
    const h = headerRow(wr, ["Week Of", "Win", "Risk"]);
    for (const r of h < 0 ? [] : tableRows(wr, h)) {
      const week = r.get("Week Of");
      const start = sheetDate(week);
      const fields = [
        "Win",
        "Risk",
        "Pick 1",
        "Pick 2",
        "Pick 3",
        "Basketball Progress",
        "Skill Progress",
        "Networking",
        "Top 3 Next Week",
        "Calendar Blocks Added?",
        "Overall Status",
        "Notes",
      ];
      if (!fields.some((f) => r.get(f))) {
        if (start)
          skipped.push({
            tab: "Weekly Review",
            row: week,
            reason: "Empty week (not yet reviewed)",
          });
        continue;
      }
      if (!start) {
        skipped.push({
          tab: "Weekly Review",
          row: `row ${r.at}`,
          reason: `Week "${week}" isn't a date`,
        });
        continue;
      }
      const picks = ["Pick 1", "Pick 2", "Pick 3"].map(r.get).filter(Boolean);
      records.push({
        table: "reviews",
        tab: "Weekly Review",
        key: `wb:review:${start}`,
        period_start: start,
        period_end: addDays(start, 6),
        achievements: r.get("Win"),
        obstacles: r.get("Risk"),
        priorities: [
          r.get("Top 3 Next Week"),
          ...picks.map((p) => `Pick: ${p}`),
        ]
          .filter(Boolean)
          .join("\n"),
        conversation_summary: r.get("Notes"),
        details: {
          picks,
          picks_for: start,
          basketball: r.get("Basketball Progress") || null,
          skills: r.get("Skill Progress") || null,
          networking: r.get("Networking") || null,
          top_three: r.get("Top 3 Next Week") || null,
          calendar_blocks: r.get("Calendar Blocks Added?") || null,
          overall_status: r.get("Overall Status") || null,
          source: "Weekly Review tab",
        },
      });
    }
  }

  // Reference material: Calendar Playbook and the Dashboard's long-term
  // targets. Kept whole and readable; no screen of its own.
  const ref = (
    key: string,
    tab: TabName,
    title: string,
    details: Record<string, unknown>,
    i: number,
  ) =>
    records.push({
      table: "career_entries",
      tab,
      key: `wb:reference:${key}`,
      kind: "reference",
      title,
      status: "unknown",
      due_date: null,
      details,
      sort_order: i,
    });
  const cal = need("Calendar Playbook");
  if (cal) {
    const h = headerRow(cal, ["PUT ON CALENDAR", "Cadence"]);
    const put: Record<string, string>[] = [];
    const dont: Record<string, string>[] = [];
    let principle = "";
    for (let i = h + 1; h >= 0 && i < cal.values.length; i++) {
      const row = cal.values[i].map(text);
      if (row[0] && !row[1] && !row[5] && row[0].length > 40)
        principle = row[0];
      else if (row[0])
        put.push({
          what: row[0],
          cadence: row[1],
          length: row[2],
          purpose: row[3],
        });
      if (row[5]) dont.push({ what: row[5], why: row[6], instead: row[7] });
    }
    ref(
      "calendar-playbook",
      "Calendar Playbook",
      "Calendar Playbook",
      { put_on_calendar: put, do_not_put: dont, principle },
      0,
    );
  }
  const dash = need("Dashboard");
  if (dash) {
    const ns = headerRow(dash, ["North Star", "KPI"]);
    if (ns >= 0) {
      const north: Record<string, string>[] = [];
      const kpis: Record<string, string>[] = [];
      for (const r of tableRows(dash, ns)) {
        if (r.get("North Star"))
          north.push({ name: r.get("North Star"), target: r.get("Target") });
        if (r.get("KPI")) {
          const row = dash.values[r.at - 1].map(text);
          kpis.push({
            kpi: row[3],
            target: row[4],
            current: row[5],
            status: row[6],
            notes: row[7],
          });
        }
      }
      ref(
        "north-star",
        "Dashboard",
        "North Star and KPIs",
        { north_star: north, kpis },
        1,
      );
    }
    const pr = headerRow(dash, ["Priority", "Objective", "Measure"]);
    if (pr >= 0)
      ref(
        "fall-2026-priorities",
        "Dashboard",
        "Current priority: Fall 2026",
        {
          rows: tableRows(
            dash,
            pr,
            (row) =>
              !/^(critical|high|medium|low)$/i.test(
                row[dash.values[pr].map(text).indexOf("Priority")] ?? "",
              ),
          ).map((r) => ({
            priority: r.get("Priority"),
            objective: r.get("Objective"),
            measure: r.get("Measure"),
            status: r.get("Status"),
            next_action: r.get("Next Action"),
            deadline: r.get("Deadline"),
            why: r.get("Why It Matters"),
            weekly_check: r.get("Weekly Check"),
          })),
          // What the workbook's own formulas show, to check against.
          metrics: Object.fromEntries(
            (() => {
              const m = headerRow(dash, ["Dashboard Metrics", "Value"]);
              return m < 0
                ? []
                : tableRows(dash, m).map((r) => [
                    r.get("Dashboard Metrics"),
                    r.get("Value"),
                  ]);
            })(),
          ),
        },
        2,
      );
    const ms = headerRow(dash, ["#", "Objective", "Evidence / current state"]);
    if (ms >= 0)
      ref(
        "november-2026-milestones",
        "Dashboard",
        "November 2026 career milestones (self-set)",
        {
          rows: tableRows(
            dash,
            ms,
            (row) => !/^\d+$/.test(row[dash.values[ms].map(text).indexOf("#")]),
          ).map((r) => ({
            n: r.get("#"),
            objective: r.get("Objective"),
            evidence: r.get("Evidence / current state"),
            status: r.get("Status"),
            next_action: r.get("Next action"),
            target: r.get("Target"),
            guardrail: r.get("Guardrail"),
            note: r.get("Progress note"),
          })),
        },
        3,
      );
  }
  const ccc = need("Course Command Centre");
  if (ccc) {
    const h = headerRow(ccc, ["Course", "Next Assessment"]);
    if (h >= 0)
      ref(
        "course-command-centre",
        "Course Command Centre",
        "Course notes from the workbook",
        {
          rows: tableRows(ccc, h).map((r) => ({
            course: r.get("Course"),
            next_assessment: r.get("Next Assessment"),
            due: r.get("Due Date"),
            assessed_avg: r.get("Assessed avg"),
            target_grade: r.get("Target Grade"),
            next_action: r.get("Next Action"),
            action_check: r.get("Action check"),
            topic_mastery: r.get("Topic mastery (1–5)"),
            priority: r.get("Priority"),
            study_hours: r.get("Study Hrs / Wk"),
            status: r.get("Status"),
            notes: r.get("Notes"),
          })),
        },
        4,
      );
  }
  return { records, skipped, missing };
}

/** Academic rows, compared with Life OS (not imported again; see reconcile). */
export function readAcademicRows(wb: Workbook) {
  const out = {
    assessments: [] as Record<string, string>[],
    topics: [] as Record<string, string>[],
    courses: [] as Record<string, string>[],
  };
  const grab = (
    name: TabName,
    labels: string[],
    into: Record<string, string>[],
  ) => {
    const t = tabOf(wb, name);
    if (!t) return;
    const h = headerRow(t, labels);
    if (h < 0) return;
    const heads = t.values[h].map(text);
    for (const r of tableRows(t, h))
      into.push(
        Object.fromEntries(heads.filter(Boolean).map((x) => [x, r.get(x)])),
      );
  };
  grab(
    "Assessments & Grades",
    ["Course", "Assessment", "Weight %"],
    out.assessments,
  );
  grab("Knowledge Mastery", ["Course", "Topic / Concept"], out.topics);
  grab("Course Command Centre", ["Course", "Next Assessment"], out.courses);
  return out;
}
