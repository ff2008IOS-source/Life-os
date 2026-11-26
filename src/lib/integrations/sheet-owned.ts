import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { addDays, format } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../auth";
import { dbError } from "../http";
import { integrationAdmin } from "./google-server";
import {
  datasetConfig,
  localPatch,
  validateField,
  same,
  type Values,
} from "./sheet-ledger-model";
import { contentHash } from "./sheet-rest-snapshot";
import {
  ledgerRows,
  ownedDataset,
  synchronizeDataset,
  type Dataset,
  type LedgerRow,
} from "./sheet-rest-server";
import {
  buildWeeklyReview,
  type ReviewAssessment,
  type ReviewTask,
} from "./career-sheet-content";

/** Deterministic request id: the same row version and patch can never queue twice. */
const requestId = (...parts: unknown[]) => {
  const h = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export type PreviewChange = {
  row_id: string;
  key: unknown;
  fields: Record<string, { from: unknown; to: unknown }>;
};

/** What Life OS would push right now. Creates nothing. Frozen history is never listed. */
export async function previewOwned(d: Dataset): Promise<PreviewChange[]> {
  if (d.mode !== "life_os_owned") return [];
  const config = datasetConfig.parse(d.config);
  const out: PreviewChange[] = [];
  for (const r of await ledgerRows(d)) {
    if (r.frozen || r.state !== "pending") continue;
    const patch = localPatch(r.baseline, r.local_values, config);
    if (!Object.keys(patch).length) continue;
    out.push({
      row_id: r.id,
      key: r.key_values,
      fields: Object.fromEntries(
        Object.entries(patch).map(([k, v]) => [
          k,
          { from: r.baseline[k]?.value ?? null, to: v },
        ]),
      ),
    });
  }
  return out;
}

/**
 * Turn sheet drift into ordinary outbox operations. They are drafts (preview, then approve) unless
 * the table has automatic approval. Never touches frozen rows; the database also refuses them.
 */
export async function queueOwnedCorrections(user: string, id: string) {
  const d = await ownedDataset(user, id);
  if (d.mode !== "life_os_owned") return 0;
  const db = integrationAdmin();
  let queued = 0;
  for (const c of await previewOwned(d)) {
    const row = (await ledgerRows(d)).find((r) => r.id === c.row_id)!;
    const values = Object.fromEntries(
      Object.entries(c.fields).map(([k, v]) => [k, v.to]),
    ) as Values;
    const r = await db.rpc("edit_sheet_rest", {
      p_user: user,
      p_dataset: id,
      p_row: row.id,
      p_version: row.version,
      p_request: requestId(row.id, row.version, values),
      p_type: "update",
      p_values: values,
      p_key: null,
      p_key_values: null,
    });
    dbError(r.error);
    queued++;
  }
  if (queued)
    await db
      .from("sheet_rest_datasets")
      .update({ next_sync_at: new Date().toISOString() })
      .eq("id", id);
  return queued;
}

export async function syncAndCorrect(user: string, id: string) {
  const result = await synchronizeDataset(user, id);
  return { ...result, queued: await queueOwnedCorrections(user, id) };
}

/** Restore the values an earlier confirmed write replaced. Goes through the same draft/approve path. */
export async function undoOperation(
  user: string,
  datasetId: string,
  operationId: string,
) {
  const db = integrationAdmin();
  const d = await ownedDataset(user, datasetId);
  const op = await db
    .from("sheet_rest_operations")
    .select("*")
    .eq("user_id", user)
    .eq("dataset_id", datasetId)
    .eq("id", operationId)
    .single();
  dbError(op.error);
  const o = op.data!;
  if (o.status !== "confirmed")
    throw new ApiError(409, "Only a completed change can be undone.");
  if (o.operation_type !== "update")
    throw new ApiError(
      422,
      "Undo covers edits to existing rows. Remove an added row in the sheet and sync.",
    );
  const row = (await ledgerRows(d)).find((r) => r.id === o.row_id);
  if (!row || row.frozen) throw new ApiError(404, "Record unavailable.");
  const back: Values = {};
  for (const k of Object.keys(o.intended as Values))
    back[k] =
      (o.expected_cells as Record<string, { value: Values[string] }>)[k]
        ?.value ?? null;
  if (same(back, o.intended))
    throw new ApiError(422, "Nothing to undo for this change.");
  const r = await db.rpc("edit_sheet_rest", {
    p_user: user,
    p_dataset: datasetId,
    p_row: row.id,
    p_version: row.version,
    p_request: randomUUID(),
    p_type: "update",
    p_values: back,
    p_key: null,
    p_key_values: null,
  });
  dbError(r.error);
  return { operation_id: r.data as string, restores: back };
}

/** Recent completed changes, newest first, for the change log and undo. */
export async function changeLog(user: string, datasetId: string) {
  const r = await integrationAdmin()
    .from("sheet_rest_operations")
    .select("id,row_id,operation_type,intended,expected_cells,verified_at")
    .eq("user_id", user)
    .eq("dataset_id", datasetId)
    .eq("status", "confirmed")
    .order("verified_at", { ascending: false })
    .limit(25);
  dbError(r.error);
  return r.data ?? [];
}

const monday = (iso: string) => {
  const d = new Date(iso + "T12:00:00Z");
  return format(addDays(d, -((d.getUTCDay() + 6) % 7)), "yyyy-MM-dd");
};

/** Gather Life OS evidence for one Weekly Review week and queue it as a normal edit or insert. */
export async function proposeWeeklyReview(
  db: SupabaseClient,
  user: string,
  datasetId: string,
  anyDayInWeek: string,
) {
  const d = await ownedDataset(user, datasetId);
  if (d.mode !== "life_os_owned")
    throw new ApiError(409, "This table is not owned by Life OS.");
  const config = datasetConfig.parse(d.config);
  if (!config.columns.some((c) => c.key === "week_of"))
    throw new ApiError(422, "This is not the Weekly Review table.");
  const start = monday(anyDayInWeek),
    next = format(addDays(new Date(start + "T12:00:00Z"), 7), "yyyy-MM-dd"),
    nextEnd = format(addDays(new Date(next + "T12:00:00Z"), 7), "yyyy-MM-dd");
  const zone = "America/Vancouver",
    at = (day: string) => fromZonedTime(`${day}T00:00:00`, zone).toISOString(),
    local = (iso: string) =>
      formatInTimeZone(new Date(iso), zone, "yyyy-MM-dd");
  const [courses, history, deadlines, done, open] = await Promise.all([
    db.from("courses").select("id,code").eq("user_id", user).limit(100),
    // Canvas grade changes recorded during the review week (scored submissions only).
    db
      .from("canvas_grade_history")
      .select("canvas_id,current_state,recorded_at")
      .eq("user_id", user)
      .gte("recorded_at", at(start))
      .lt("recorded_at", at(next))
      .limit(500),
    // Canvas deadlines (a live view over synced assignments) for this and next week.
    db
      .from("canvas_deadlines")
      .select("title,due_at,course_code,submission_state")
      .eq("user_id", user)
      .or("published.is.null,published.eq.true")
      .gte("due_at", at(start))
      .lt("due_at", at(nextEnd))
      .order("due_at")
      .limit(200),
    db
      .from("tasks")
      .select("id")
      .eq("user_id", user)
      .is("deleted_at", null)
      .gte("completed_at", at(start))
      .lt("completed_at", at(next))
      .limit(500),
    db
      .from("tasks")
      .select("title,due_date,due_at")
      .eq("user_id", user)
      .is("deleted_at", null)
      .not("status", "in", "(completed,cancelled)")
      .limit(200),
  ]);
  for (const x of [courses, history, deadlines, done, open]) dbError(x.error);
  const code = new Map(courses.data!.map((c) => [c.id, c.code as string]));
  // submission:<course>:<assignment>:<student> -> assessment source_key canvas:<course>:<assignment>
  const keys = [
    ...new Set(
      history
        .data!.filter(
          (h) =>
            (h.current_state as { score?: number | null })?.score != null &&
            String(h.canvas_id).split(":").length >= 3,
        )
        .map(
          (h) =>
            `canvas:${String(h.canvas_id).split(":")[1]}:${String(h.canvas_id).split(":")[2]}`,
        ),
    ),
  ];
  const graded = keys.length
    ? await db
        .from("assessments")
        .select("course_id,title,earned_score,maximum_score,due_date,dropped")
        .eq("user_id", user)
        .in("source_key", keys)
        .limit(200)
    : { data: [], error: null };
  dbError(graded.error);
  const gradedThisWeek: ReviewAssessment[] = (graded.data ?? [])
    .filter((a) => !a.dropped && a.earned_score != null)
    .map((a) => ({
      course: code.get(a.course_id) ?? "Course",
      title: a.title,
      earned: a.earned_score,
      max: a.maximum_score,
      due_date: a.due_date,
      graded: true,
    }));
  const open_ = (deadlines.data ?? []).filter(
    (d) =>
      !["submitted", "graded", "excused"].includes(d.submission_state ?? ""),
  );
  const inWeek = (iso: string | null, a: string, b: string) => {
    const day = iso ? local(iso) : null;
    return !!day && day >= a && day < b;
  };
  const today = format(new Date(), "yyyy-MM-dd");
  const dueNextWeek: ReviewAssessment[] = open_
    .filter((d) => inWeek(d.due_at, start, nextEnd))
    .map((d) => ({
      course: d.course_code ?? "Course",
      title: d.title,
      earned: null,
      max: null,
      due_date: local(d.due_at),
      graded: false,
    }));
  const tasks = open.data!.map((t) => ({
    title: t.title as string,
    due_date:
      (t.due_date as string | null) ?? (t.due_at ? local(t.due_at) : null),
  }));
  const nextWeekItems: ReviewTask[] = [
    ...tasks.filter((t) =>
      inWeek(t.due_date && t.due_date + "T12:00:00Z", next, nextEnd),
    ),
    ...open_
      .filter((d) => inWeek(d.due_at, next, nextEnd))
      .map((d) => ({
        title: `${d.course_code ?? ""} ${d.title}`.trim(),
        due_date: local(d.due_at),
      })),
  ].sort((x, y) => String(x.due_date).localeCompare(String(y.due_date)));
  const values = buildWeeklyReview({
    weekStart: start,
    gradedThisWeek,
    completedTaskCount: done.data!.length,
    overdue: tasks.filter((t) => t.due_date && t.due_date < today),
    dueNextWeek,
    topTasksNextWeek: nextWeekItems,
  });
  const key = [values.week_of];
  const row = (await ledgerRows(d)).find(
    (r) => r.external_key === contentHash(key),
  );
  return proposeOwnedValues(user, d, config, row ?? null, values, key);
}

/** Single validated entry point for Life OS to put values into an owned table. */
export async function proposeOwnedValues(
  user: string,
  d: Dataset,
  config: ReturnType<typeof datasetConfig.parse>,
  row: LedgerRow | null,
  values: Values,
  key: unknown[],
) {
  if (row?.frozen)
    throw new ApiError(
      409,
      "That record predates Life OS ownership and stays as you wrote it.",
    );
  const patch: Values = {};
  for (const [k, v] of Object.entries(values)) {
    const c = config.columns.find((c) => c.key === k);
    if (!c) throw new ApiError(403, "Unmapped field.");
    if (c.key_part) continue;
    if (!c.writable) throw new ApiError(403, "Source-owned field.");
    validateField(c, v, row?.remote_cells[k]);
    if (!row || !same(row.local_values[k] ?? null, v)) patch[k] = v;
  }
  if (!Object.keys(patch).length) return { unchanged: true as const };
  if (!row && !config.columns.every((c) => !c.key_part || key.length))
    throw new ApiError(422, "Missing identity.");
  const insert = !row;
  const send: Values = insert
    ? Object.fromEntries(
        config.columns
          .filter((c) => c.key_part)
          .map((c, n) => [c.key, key[n] as Values[string]])
          .concat(Object.entries(patch)),
      )
    : patch;
  const r = await integrationAdmin().rpc("edit_sheet_rest", {
    p_user: user,
    p_dataset: d.id,
    p_row: row?.id ?? requestId(d.id, key, "row"),
    p_version: row?.version ?? 0,
    p_request: requestId(d.id, row?.id ?? key, row?.version ?? 0, send),
    p_type: insert ? "insert" : "update",
    p_values: send,
    p_key: contentHash(key),
    p_key_values: key,
  });
  dbError(r.error);
  return { operation_id: r.data as string, insert };
}
