import { z } from "zod";

export const topicReply = z
  .object({
    topics: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(150),
            section: z.string().trim().max(150),
            source_file: z.string().min(1).max(500),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();

export function topicKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function parseTopicReply(
  response: unknown,
  file: string,
  excerpt: string,
  existing: string[] = [],
) {
  const seen = new Set(existing.map(topicKey));
  const source = " " + topicKey(file + " " + excerpt) + " ";
  return topicReply.parse(response).topics.filter((topic) => {
    const key = topicKey(topic.title);
    if (
      topic.source_file !== file ||
      !key ||
      seen.has(key) ||
      !source.includes(" " + key + " ")
    )
      return false;
    if (topic.section && !source.includes(" " + topicKey(topic.section) + " "))
      return false;
    seen.add(key);
    return true;
  });
}

type Row = Record<string, unknown>;
const localDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Vancouver",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function day(value: unknown) {
  const raw = String(value);
  if (/^\d{4}-\d\d-\d\d$/.test(raw)) return Date.parse(raw) / 86400000;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? Date.parse(localDay.format(ms)) / 86400000 : NaN;
}
function ranges(text: string, kind: string) {
  return [
    ...text.matchAll(
      new RegExp(
        "\\b(?:" + kind + ")\\.?\\s*(\\d+)(?:\\s*(?:[-–—]|to)\\s*(\\d+))?",
        "gi",
      ),
    ),
  ].map((m) => [Number(m[1]), Number(m[2] ?? m[1])]);
}
function overlap(a: string, b: string, kind: string) {
  return ranges(a, kind).some(([l, h]) =>
    ranges(b, kind).some(([x, y]) => l <= y && x <= h),
  );
}
export function studyTopicEvidence(
  topic: Row,
  assessments: Row[],
  sessions: Row[],
  now: Date,
) {
  let mastery = String(topic.mastery ?? "unstudied"),
    reason = "";
  const today = day(now.toISOString()),
    scope = [
      topic.title,
      topic.section,
      topic.source_file,
      topic.source_folder,
      topic.notes,
    ]
      .filter(Boolean)
      .join(" ");
  let latest = -Infinity,
    examDays = Infinity,
    exam = "";
  for (const a of assessments) {
    if (
      a.course_id !== topic.course_id ||
      a.dropped ||
      a.submission_state === "excused"
    )
      continue;
    const title = String(a.title),
      coverage = title + " " + String(a.notes ?? "");
    const days = day(a.due_at ?? a.due_date) - today;
    const examMatch =
      /\b(exam|midterm|final)\b/i.test(title) &&
      ((" " + topicKey(scope) + " ").includes(" " + topicKey(title) + " ") ||
        overlap(scope, coverage, "weeks?"));
    if (
      examMatch &&
      days >= 0 &&
      days < 14 &&
      days < examDays &&
      a.earned_score == null &&
      (!a.due_at || Date.parse(String(a.due_at)) > now.getTime())
    ) {
      examDays = days;
      exam =
        title +
        (days === 0
          ? " today"
          : " in " + days + (days === 1 ? " day" : " days"));
    }
    const matches =
      overlap(scope, title, "ch(?:apters?)?") ||
      (" " + topicKey(title) + " ").includes(
        " " + topicKey(String(topic.title)) + " ",
      ) ||
      (" " + topicKey(scope) + " ").includes(" " + topicKey(title) + " ");
    if (!matches || a.earned_score == null || !(Number(a.maximum_score) > 0))
      continue;
    const pct = (100 * Number(a.earned_score)) / Number(a.maximum_score);
    const at = Date.parse(
      String(a.graded_at ?? a.due_at ?? a.due_date ?? a.created_at),
    );
    if (pct < 70 && (Number.isFinite(at) ? at : 0) >= latest) {
      latest = Number.isFinite(at) ? at : 0;
      mastery = "needs_review";
      reason = title + ": " + Number(pct.toFixed(1)) + "%";
    }
  }
  for (const s of sessions) {
    if (s.course_id !== topic.course_id || s.topic_id !== topic.id) continue;
    const when = s.end_at ?? s.created_at,
      at = Date.parse(String(when));
    if (!Number.isFinite(at) || at < latest || at > now.getTime()) continue;
    latest = at;
    const age = today - day(when);
    mastery = age >= 14 ? "needs_review" : "practicing";
    reason =
      age === 0
        ? "Studied today"
        : "Last studied " + age + (age === 1 ? " day" : " days") + " ago";
  }
  if (
    mastery === "practicing" &&
    latest === -Infinity &&
    today - day(topic.updated_at) >= 14
  ) {
    mastery = "needs_review";
    reason = "No review logged for 14 days";
  }
  if (topic.mastery_manual) {
    mastery = String(topic.mastery);
    reason = "Set by you";
  }
  return { mastery, reason: [exam, reason].filter(Boolean).join(" · ") };
}
