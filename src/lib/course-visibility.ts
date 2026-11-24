import { termKey } from "./career-order";

type Term = { id: string; name?: unknown; created_at?: unknown };
type Course = { id: string; term_id?: unknown };

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Newest term first: Spring 2027 before Fall 2026; unnamed terms last. */
export function orderTerms<T extends Term>(terms: T[]) {
  return [...terms].sort(
    (a, b) =>
      (termKey(str(b.name)) ?? -1) - (termKey(str(a.name)) ?? -1) ||
      str(b.created_at).localeCompare(str(a.created_at)),
  );
}

/**
 * Which term School shows and which courses are visible in it.
 *
 * - School opens on the newest named semester that has courses, or on the
 *   term of a linked course.
 * - Courses in an undated term (Canvas's "Default Term", e.g. SFU 101) show
 *   alongside whichever semester is selected, so they're never hidden.
 * - With no named semester at all, every course shows ("" = all terms).
 */
export function visibleCourses<C extends Course>(
  terms: Term[],
  courses: C[],
  choice: string | null,
  linkedCourse?: string,
) {
  const dated = (id: unknown) =>
    termKey(str(terms.find((t) => t.id === id)?.name)) !== null;
  const newest = orderTerms(terms).find(
    (t) => dated(t.id) && courses.some((c) => c.term_id === t.id),
  );
  const linked = courses.find((c) => c.id === linkedCourse);
  const term =
    choice ??
    (linked && dated(linked.term_id)
      ? str(linked.term_id)
      : linked
        ? ""
        : str(newest?.id));
  return {
    term,
    courses: courses.filter(
      (c) => !term || c.term_id === term || (dated(term) && !dated(c.term_id)),
    ),
  };
}
