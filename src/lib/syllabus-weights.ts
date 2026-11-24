/**
 * Reads the grading breakdown out of a syllabus' text: the run of
 * "Component … NN%" entries that adds up to 100%. Returns null when no such
 * breakdown is found, so nothing is ever guessed.
 */
export type SyllabusWeight = { name: string; weight: number };

const HEADER =
  /^(?:(?:course\s+)?(?:assessments?|assignments?|grading|grades?|evaluation|marking|breakdown|components?|weightings?|summary|overall|points|percentage|of|and|the|grade|your|table|below|in)\b[\s:–-]*)+/i;

function cleanLabel(raw: string) {
  let s = raw;
  // Keep only the last sentence before the percentage.
  const sentence = s.split(/[.!?]\s+(?=[A-Z])/);
  s = sentence[sentence.length - 1];
  s = s
    .replace(/\([^)]*\)?/g, " ") // parentheticals and a dangling "("
    .replace(/^[)\s,;:]+/, " ")
    .replace(/\b\d+(\.\d+)?\s*(pts?|points?|marks?)\b/gi, " ")
    .replace(/\b\d+\s*x\s*\d+(\.\d+)?\b/gi, " ")
    .replace(/[,;:=–-]+\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // A long run-in is a heading or sentence; the label is its last few words.
  if (s.length > 60) s = s.slice(s.indexOf(" ", s.length - 60) + 1);
  // Text cut from the middle of a bracket ends at a stray ")": drop it.
  s = s.replace(/^[^()]*\)\s*/, "");
  const stripped = s.replace(HEADER, "").trim();
  if (stripped.length >= 3) s = stripped;
  s = s.replace(/^[),;:–\-\s]+/, "").replace(/[(,;:–\-\s]+$/, "");
  return s.length >= 3 && s.length <= 80 ? s : null;
}

export function extractSyllabusWeights(text: string): SyllabusWeight[] | null {
  const t = text.replace(/\s+/g, " ");
  const marks = [...t.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)];
  // Try each percentage as the start of a breakdown; take the first run that
  // reaches exactly 100% with at least two components.
  for (let i = 0; i < marks.length; i++) {
    const rows: SyllabusWeight[] = [];
    let total = 0;
    let prevEnd = Math.max(0, marks[i].index! - 160);
    for (let j = i; j < marks.length && j < i + 14; j++) {
      const m = marks[j];
      const value = Number(m[1]);
      const between = t.slice(prevEnd, m.index);
      // A breakdown is a tight run; a long gap means we've left it.
      if (j > i && between.length > 220) break;
      const name = cleanLabel(between);
      prevEnd = m.index! + m[0].length;
      if (!name || value <= 0 || value > 100) continue;
      // "3 x 6% + 1 x 7% = 25%" style sub-parts belong to the previous row.
      if (/[x×+]\s*$/.test(between.trim()) || /^[x×+]/.test(between.trim()))
        continue;
      rows.push({ name, weight: value });
      total += value;
      if (Math.abs(total - 100) < 0.01 && rows.length >= 2) return rows;
      if (total > 100.01) break;
    }
  }
  return null;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(" ")
    .map((w) => w.replace(/s$/, ""))
    .filter((w) => w.length > 2 && !["the", "and", "for", "with"].includes(w));

/**
 * Best syllabus row for an assessment or Canvas group title, by shared words
 * (singular forms, so "Exams" matches "Exam 2"). Null when nothing overlaps.
 */
export function matchWeightRow(title: string, rows: SyllabusWeight[]) {
  const target = new Set(words(title));
  let best: { index: number; score: number } | null = null;
  rows.forEach((r, index) => {
    const score = words(r.name).filter((w) => target.has(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { index, score };
  });
  return best ? (best as { index: number }).index : null;
}
