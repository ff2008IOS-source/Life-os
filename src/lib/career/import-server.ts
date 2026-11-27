import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "../http";
import { localDate } from "../dates";
import {
  norm,
  readAcademicRows,
  readWorkbook,
  TABS,
  type ImportRecord,
  type TabName,
  type Workbook,
} from "./workbook";
import { syncLinkedTasks } from "./linked-tasks-server";
import { hashOf, legacyKey } from "./import-keys";
export { hashOf, legacyKey };

/**
 * Imports the career workbook into Life OS records. Safe to re-run:
 * - each record has a stable key, so nothing is duplicated;
 * - the hash of what the import last wrote is kept, so a record edited in
 *   Life OS since then is never overwritten (the workbook's differing value
 *   is kept beside it for the owner to resolve);
 * - the Nov 6 snapshot (`career_entries` with the older keys) is adopted,
 *   not duplicated;
 * - with dryRun, nothing is written and the same summary is returned.
 * Writes go through the owner's own database client, so row-level security
 * keeps every record in their account.
 */
export type Outcome =
  | "imported"
  | "updated"
  | "unchanged"
  | "kept_life_os_edit"
  | "adopted"
  | "merged";

export type TabSummary = {
  tab: TabName;
  imported: number;
  matched: number;
  skipped: { row: string; reason: string }[];
  unresolved: { record: string; issue: string }[];
  notes: string[];
};

/** The fields the import owns, per table. */
function projection(r: Record<string, unknown>, table: ImportRecord["table"]) {
  if (table === "contacts")
    return {
      name: r.name ?? null,
      organization: r.organization ?? null,
      role: r.role ?? null,
      how_met: r.how_met ?? null,
      relationship_notes: r.relationship_notes || null,
      last_contact_at: r.last_contact_at
        ? String(r.last_contact_at).slice(0, 10)
        : null,
      next_follow_up_date: r.next_follow_up_date ?? null,
    };
  if (table === "reviews")
    return {
      achievements: r.achievements || "",
      obstacles: r.obstacles || "",
      priorities: r.priorities || "",
      conversation_summary: r.conversation_summary || "",
      details: r.details ?? {},
    };
  return {
    kind: r.kind,
    title: r.title,
    status: r.status,
    due_date: r.due_date ?? null,
    details: r.details ?? {},
  };
}

function values(rec: ImportRecord) {
  if (rec.table === "contacts")
    return {
      name: rec.name,
      organization: rec.organization,
      role: rec.role,
      how_met: rec.how_met,
      relationship_notes: rec.relationship_notes ?? "",
      last_contact_at: rec.last_contact_at
        ? `${rec.last_contact_at}T12:00:00-08:00`
        : null,
      next_follow_up_date: rec.next_follow_up_date,
    };
  if (rec.table === "reviews")
    return {
      period_start: rec.period_start,
      period_end: rec.period_end,
      achievements: rec.achievements,
      obstacles: rec.obstacles,
      priorities: rec.priorities,
      conversation_summary: rec.conversation_summary,
      details: rec.details,
    };
  return {
    kind: rec.kind,
    title: rec.title.slice(0, 300),
    status: rec.status,
    due_date: rec.due_date,
    details: rec.details,
    sort_order: rec.sort_order,
  };
}

type Native = Record<string, unknown> & {
  id: string;
  version: number;
  source_key: string | null;
  import_hash: string | null;
};

export async function importWorkbook(
  db: SupabaseClient,
  user: string,
  wb: Workbook,
  opts: { dryRun: boolean; now?: Date },
) {
  const now = opts.now ?? new Date();
  const { records, skipped, missing } = readWorkbook(wb);
  const summary = new Map<TabName, TabSummary>(
    TABS.map((t) => [
      t,
      {
        tab: t,
        imported: 0,
        matched: 0,
        skipped: [],
        unresolved: [],
        notes: [],
      },
    ]),
  );
  const s = (t: TabName) => summary.get(t)!;
  for (const m of missing) s(m).notes.push("Tab not found in the workbook.");
  for (const k of skipped)
    s(k.tab).skipped.push({ row: k.row, reason: k.reason });

  // Everything already in Life OS that the import could touch.
  const load = async (table: string, cols: string) => {
    const r = await db.from(table).select(cols).eq("user_id", user).limit(2000);
    dbError(r.error);
    return (r.data ?? []) as unknown as Native[];
  };
  const career = await load(
    "career_entries",
    "id,version,kind,title,status,due_date,details,source_id,source_key,import_hash,archived_at,created_at,updated_at",
  );
  const contacts = await load(
    "contacts",
    "id,version,name,organization,role,how_met,relationship_notes,last_contact_at,next_follow_up_date,source_key,import_hash,archived_at",
  );
  const reviews = await load(
    "reviews",
    "id,version,period_start,period_end,achievements,obstacles,priorities,conversation_summary,details,source_key,import_hash",
  );
  const legacy = new Map<string, Native>();
  for (const c of career)
    if (c.source_id && !c.archived_at) {
      const k = legacyKey(c.source_key, String(c.kind));
      if (k) legacy.set(k, c);
    }
  const byKey = new Map<string, Native>();
  for (const r of [...career, ...contacts, ...reviews])
    if (r.source_key?.startsWith("wb:")) byKey.set(r.source_key, r);

  const write = async (fn: () => PromiseLike<{ error: unknown }>) => {
    if (opts.dryRun) return;
    const r = await fn();
    dbError(r.error as never);
  };
  const results: { key: string; outcome: Outcome }[] = [];
  const stamp = now.toISOString();

  for (const rec of records) {
    const t = s(rec.tab);
    const vals = values(rec);
    const hash = hashOf(projection(vals as Record<string, unknown>, rec.table));
    let existing = byKey.get(rec.key);
    // Reviews also match an existing Life OS review for the same week.
    if (!existing && rec.table === "reviews")
      existing = reviews.find((r) => r.period_start === rec.period_start);
    // Adopt the Nov 6 snapshot row instead of duplicating it.
    if (!existing && rec.table === "career_entries") {
      const old = legacy.get(rec.key);
      if (old) {
        legacy.delete(rec.key);
        const edited = Number(old.version) > 1;
        if (edited) {
          await write(() =>
            db
              .from("career_entries")
              .update({
                source_key: rec.key,
                source_id: null,
                import_hash: hashOf(projection(old, "career_entries")),
              })
              .eq("user_id", user)
              .eq("id", old.id),
          );
          t.matched++;
          t.unresolved.push({
            record: rec.title,
            issue:
              "Edited in Life OS after the Nov 6 import; kept your version. The workbook now says something different.",
          });
          results.push({ key: rec.key, outcome: "kept_life_os_edit" });
        } else {
          await write(() =>
            db
              .from("career_entries")
              .update({
                ...vals,
                source_id: null,
                source_key: rec.key,
                import_hash: hash,
                imported_at: stamp,
              })
              .eq("user_id", user)
              .eq("id", old.id),
          );
          t.matched++;
          results.push({ key: rec.key, outcome: "adopted" });
        }
        continue;
      }
    }
    if (!existing) {
      await write(() =>
        db.from(rec.table).insert({
          ...vals,
          user_id: user,
          source_key: rec.key,
          import_hash: hash,
          imported_at: stamp,
        }),
      );
      t.imported++;
      results.push({ key: rec.key, outcome: "imported" });
      continue;
    }
    t.matched++;
    const lifeOsReview =
      rec.table === "reviews" &&
      (!existing.import_hash ||
        "workbook" in ((existing.details as object | null) ?? {}));
    if (lifeOsReview) {
      // A review written in Life OS: keep it (on this and every later
      // run), fill only what it left empty, keep the workbook's beside it.
      const first = !existing.import_hash;
      const before = (existing.details as { workbook?: unknown }).workbook;
      if (!first && hashOf({ w: before }) === hashOf({ w: rec.details })) {
        results.push({ key: rec.key, outcome: "unchanged" });
        continue;
      }
      // Empty fields are filled only the first time, so clearing one in
      // Life OS later is not undone by the next import.
      const fill: Record<string, unknown> = {};
      if (first)
        for (const f of [
          "achievements",
          "obstacles",
          "priorities",
          "conversation_summary",
        ] as const)
          if (
            !String(existing[f] ?? "").trim() &&
            (vals as unknown as Record<string, string>)[f]
          )
            fill[f] = (vals as unknown as Record<string, string>)[f];
      const details = {
        ...(existing.details as object),
        workbook: rec.details,
      };
      await write(() =>
        db
          .from("reviews")
          .update({
            ...fill,
            details,
            source_key: rec.key,
            import_hash: hashOf(
              projection({ ...existing, ...fill, details }, "reviews"),
            ),
            imported_at: stamp,
          })
          .eq("user_id", user)
          .eq("id", existing!.id),
      );
      if (first && Object.keys(fill).length < 4)
        t.notes.push(
          `Week of ${rec.period_start}: kept the review written in Life OS; added the workbook's version alongside.`,
        );
      results.push({ key: rec.key, outcome: "merged" });
      continue;
    }
    const current = hashOf(projection(existing, rec.table));
    if (current === hash) {
      if (!existing.source_key)
        await write(() =>
          db
            .from(rec.table)
            .update({ source_key: rec.key, import_hash: hash })
            .eq("user_id", user)
            .eq("id", existing!.id),
        );
      results.push({ key: rec.key, outcome: "unchanged" });
      continue;
    }
    const untouched = existing.import_hash && existing.import_hash === current;
    if (untouched) {
      // Only the workbook changed since the last import: take its values.
      await write(() =>
        db
          .from(rec.table)
          .update({ ...vals, import_hash: hash, imported_at: stamp })
          .eq("user_id", user)
          .eq("id", existing!.id),
      );
      results.push({ key: rec.key, outcome: "updated" });
      continue;
    }
    // Edited in Life OS since the last import: keep the edit; keep the
    // workbook's newer value beside it for the owner to resolve.
    if (existing.import_hash && existing.import_hash !== hash) {
      const name =
        rec.table === "contacts"
          ? rec.name
          : rec.table === "reviews"
            ? `Week of ${rec.period_start}`
            : rec.title;
      t.unresolved.push({
        record: name,
        issue:
          "Changed in both Life OS and the workbook since the last import; kept your Life OS version.",
      });
      if (rec.table === "career_entries")
        await write(() =>
          db
            .from("career_entries")
            .update({
              details: {
                ...(existing!.details as object),
                _workbook: { ...vals, seen_at: stamp },
              },
            })
            .eq("user_id", user)
            .eq("id", existing!.id),
        );
    }
    results.push({ key: rec.key, outcome: "kept_life_os_edit" });
  }

  // Snapshot rows the workbook no longer has: leave them, but say so.
  for (const [key, old] of legacy) {
    const kind = String(old.kind);
    if (kind === "contact" || kind === "review") {
      // Moved to the contacts and reviews tables; retire the duplicate copy.
      if (byKey.has(key) || records.some((r) => r.key === key))
        await write(() =>
          db
            .from("career_entries")
            .update({ archived_at: stamp })
            .eq("user_id", user)
            .eq("id", old.id),
        );
      continue;
    }
    const tab: TabName =
      kind === "application_target"
        ? "Network & Applications"
        : kind === "skill" || kind === "portfolio_project"
          ? "Skills & Portfolio"
          : kind === "career_goal"
            ? "Semester Plan"
            : key.startsWith("wb:coop")
              ? "Internship & Co-op Roadmap"
              : "4-Year Roadmap";
    s(tab).unresolved.push({
      record: String(old.title),
      issue:
        "In the Nov 6 import but no longer in the workbook (renamed or removed). Kept in Life OS; archive it if it's obsolete.",
    });
  }

  // Academic tabs were imported natively earlier: compare, never overwrite.
  await reconcileAcademics(db, user, wb, s);
  // Dashboard formulas: check the arithmetic the workbook shows.
  verifyDashboard(records, s("Dashboard"));

  if (!opts.dryRun) await syncLinkedTasks(db, user, localDate(now));
  return {
    dry_run: opts.dryRun,
    tabs: TABS.map((t) => summary.get(t)!),
    results,
  };
}

/** Assessments, topics and courses: matched against Life OS and Canvas. */
async function reconcileAcademics(
  db: SupabaseClient,
  user: string,
  wb: Workbook,
  s: (t: TabName) => TabSummary,
) {
  const rows = readAcademicRows(wb);
  const [assess, topics, courses] = await Promise.all([
    db
      .from("assessments")
      .select(
        "id,course_id,title,earned_score,maximum_score,due_date,due_at,submission_state,source_key,updated_at",
      )
      .eq("user_id", user),
    db
      .from("study_topics")
      .select("id,course_id,title,mastery,source_key")
      .eq("user_id", user),
    db.from("courses").select("id,code").eq("user_id", user),
  ]);
  dbError(assess.error);
  dbError(topics.error);
  dbError(courses.error);
  const codeOf = new Map(
    (courses.data ?? []).map((c) => [
      c.id,
      String(c.code).replace(/W$/, "").trim(),
    ]),
  );
  const sameCourse = (id: string, code: string) =>
    (codeOf.get(id) ?? "").replace(/\s+/g, "") ===
    code.replace(/W$/, "").replace(/\s+/g, "");
  const a = s("Assessments & Grades");
  for (const r of rows.assessments) {
    if (!r.Course || !r.Assessment) continue;
    const match = (assess.data ?? []).find(
      (x) =>
        sameCourse(String(x.course_id), r.Course) &&
        norm(String(x.title)) === norm(r.Assessment),
    );
    if (!match) {
      a.unresolved.push({
        record: `${r.Course} · ${r.Assessment}`,
        issue:
          "Not in Life OS. Add it in School if it's still part of the course.",
      });
      continue;
    }
    a.matched++;
    const sheetPct = r["Score %"]
      ? Number(String(r["Score %"]).replace("%", ""))
      : null;
    const nativePct =
      match.earned_score !== null && match.maximum_score
        ? Math.round(
            (Number(match.earned_score) / Number(match.maximum_score)) * 1000,
          ) / 10
        : null;
    if (sheetPct === null && nativePct !== null)
      a.notes.push(
        `${r.Course} · ${r.Assessment}: Life OS has ${nativePct}%, the workbook is blank (newer mark kept).`,
      );
    else if (sheetPct !== null && nativePct === null)
      a.unresolved.push({
        record: `${r.Course} · ${r.Assessment}`,
        issue: `Workbook shows ${sheetPct}%, Life OS has no score. Confirm the mark before entering it.`,
      });
    else if (
      sheetPct !== null &&
      nativePct !== null &&
      Math.abs(sheetPct - nativePct) > 0.6
    )
      a.unresolved.push({
        record: `${r.Course} · ${r.Assessment}`,
        issue: `Workbook ${sheetPct}% vs Life OS ${nativePct}%.`,
      });
  }
  const k = s("Knowledge Mastery");
  for (const r of rows.topics) {
    if (!r.Course || !r["Topic / Concept"]) continue;
    const match = (topics.data ?? []).find(
      (x) =>
        sameCourse(String(x.course_id), r.Course) &&
        norm(String(x.title)) === norm(r["Topic / Concept"]),
    );
    if (match) k.matched++;
    else
      k.unresolved.push({
        record: `${r.Course} · ${r["Topic / Concept"]}`,
        issue: "Not in Life OS study topics.",
      });
  }
  const c = s("Course Command Centre");
  const averaged: string[] = [];
  for (const r of rows.courses) {
    if (!r.Course) continue;
    const id = [...codeOf.entries()].find(
      ([, code]) => code.replace(/\s+/g, "") === r.Course.replace(/\s+/g, ""),
    )?.[0];
    if (!id) {
      c.unresolved.push({
        record: r.Course,
        issue: "No matching course in Life OS.",
      });
      continue;
    }
    c.matched++;
    // The summary columns are calculations; Life OS computes its own.
    if (
      r["Next Action"] &&
      r["Next Assessment"] &&
      !norm(r["Next Action"]).includes(norm(r["Next Assessment"]))
    )
      c.notes.push(
        `${r.Course}: the workbook's Next Action was older than its next assessment, so the next step is now "Prepare for ${r["Next Assessment"]}${r["Due Date"] ? ` (${r["Due Date"]})` : ""}".`,
      );
    if (r["Assessed avg"]) averaged.push(r.Course);
  }
  if (averaged.length)
    c.notes.push(
      `The workbook's "Assessed avg" for ${averaged.join(", ")} isn't used: School computes each course grade from Canvas and the syllabus weights.`,
    );
}

/** Dashboard metrics are formulas over the Fall 2026 priority table. */
function verifyDashboard(records: ImportRecord[], t: TabSummary) {
  const pr = records.find((r) => r.key === "wb:reference:fall-2026-priorities");
  if (!pr || pr.table !== "career_entries") return;
  const rows = (pr.details.rows as { status: string }[]) ?? [];
  if (!rows.length) return;
  const complete = rows.filter((r) => /^complete/i.test(r.status)).length;
  const progress = rows.filter((r) =>
    /progress|on track/i.test(r.status),
  ).length;
  const risk = rows.filter((r) => /risk/i.test(r.status)).length;
  const pct = Math.round((complete / rows.length) * 100) + "%";
  const shown = (pr.details.metrics ?? {}) as Record<string, string>;
  const pairs: [string, string, string][] = [
    ["Current priorities", String(rows.length), shown["Current priorities"]],
    ["Complete", String(complete), shown["Complete"]],
    [
      "On Track / In Progress",
      String(progress),
      shown["On Track / In Progress"],
    ],
    ["At Risk", String(risk), shown["At Risk"]],
    ["Completion %", pct, shown["Completion %"]],
  ];
  const off = pairs.filter(
    ([, mine, theirs]) => theirs != null && theirs !== mine,
  );
  const list = pairs.map(([k, v]) => `${k} ${v}`).join(", ");
  if (!Object.keys(shown).length)
    t.notes.push(
      `Recomputed the dashboard metrics from its priority table: ${list}. The workbook's metrics table wasn't found to compare.`,
    );
  else if (off.length)
    t.unresolved.push({
      record: "Dashboard metrics",
      issue: `Recomputed from the priority table: ${list}; the workbook shows ${off.map(([k, , v]) => `${k} ${v}`).join(", ")}.`,
    });
  else
    t.notes.push(
      `Dashboard metrics verified: recomputing from the priority table gives the same values the workbook shows (${list}).`,
    );
  t.notes.push(
    "Next actions, Coming up, Check status and Career focus are formulas over other tabs; Today and Week now compute the same from Life OS records.",
  );
}
