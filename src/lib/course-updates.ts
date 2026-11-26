/**
 * Course updates from Canvas announcements and forwarded emails: which
 * course they're about, and whether they may change grading, dates or
 * report a new mark. Plain rules, so a flag is always explainable.
 */
export type UpdateFlag = "grading" | "schedule" | "mark";

const RULES: Record<UpdateFlag, RegExp> = {
  grading:
    /\b(weight(?:ed|ing|s)?|worth|grading (?:scheme|policy|breakdown)|count(?:s|ed)? (?:for|towards?)|drop(?:ped)? (?:the )?lowest|reweigh|curve|bonus (?:marks?|points?)|out of \d+|percent(?:age)? of (?:your|the) (?:final )?grade)\b/i,
  schedule:
    /\b(postpone[sd]?|reschedul\w*|moved? (?:to|from)|new (?:date|time|room|location)|due date|deadline (?:is|has been)?\s*(?:extended|changed|moved)|extension|cancel(?:l?ed|ling)|no (?:class|lecture|tutorial)|room change|location change)\b/i,
  mark: /\b(grades? (?:are |have been |is )?(?:now )?(?:posted|released|available|returned)|marks? (?:are|have been) (?:posted|released|returned)|results? (?:are|is) (?:now )?available|(?:feedback and )?scores? (?:for [^.\n]{1,60} )?(?:are|is) (?:now )?ready|graded|crowdmark)\b/i,
};

export function updateFlags(title: string, body: string): UpdateFlag[] {
  const text = `${title}\n${body}`;
  return (Object.keys(RULES) as UpdateFlag[]).filter((f) =>
    RULES[f].test(text),
  );
}

const compact = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * The course a message is about, from a course code anywhere in its
 * subject or body ("ECON 115", "Econ115", "[ECON-115]"). Null if none or
 * more than one course matches.
 */
export function matchCourse<C extends { id: string; code: unknown }>(
  text: string,
  courses: C[],
): string | null {
  const t = text.toUpperCase().replace(/[^A-Z0-9]/g, " ");
  const squashed = t.replace(/\s+/g, "");
  const hits = courses.filter((c) => {
    const code = compact(String(c.code ?? ""));
    if (code.length < 5) return false;
    const m = code.match(/^([A-Z]+)(\d+[A-Z]?)$/);
    if (!m) return squashed.includes(code);
    return new RegExp(`\\b${m[1]}\\s*${m[2]}\\b`).test(t);
  });
  return hits.length === 1 ? hits[0].id : null;
}

/** HTML from Canvas or email to readable plain text. */
export function plainText(html: string, max = 8000) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&rsquo;/g, "’")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/**
 * Password-reset emails never reach Life OS (owner rule). Sign-in codes are
 * fine. The Gmail script applies the same test before sending; this is the
 * server-side backstop.
 */
export const PASSWORD_RESET =
  /\b(?:reset|recover|forgot(?:ten)?|change)\b[^\n.]{0,40}\bpassword\b|\bpassword\b[^\n.]{0,20}\b(?:reset|recovery|change request)\b/i;

export function isPasswordReset(subject: string, body: string) {
  return (
    PASSWORD_RESET.test(subject) || PASSWORD_RESET.test(body.slice(0, 1500))
  );
}

/** Only SFU mail is kept: from, to or cc an sfu.ca address. */
export const isSfuMail = (from: string, to: string) =>
  /@(?:[a-z0-9-]+\.)*sfu\.ca\b/i.test(`${from} ${to}`);
