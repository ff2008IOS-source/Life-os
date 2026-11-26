/**
 * SFU mail that isn't about a course, sorted the way a person would: real
 * people first, then automatic mail folded into groups.
 */
export type MailGroup =
  | "People"
  | "Registrar & enrolment"
  | "Money"
  | "Housing"
  | "Research credits"
  | "Athletics"
  | "Library"
  | "Canvas"
  | "Orders & accounts"
  | "Other";

export const GROUP_ORDER: MailGroup[] = [
  "People",
  "Registrar & enrolment",
  "Money",
  "Athletics",
  "Housing",
  "Research credits",
  "Library",
  "Canvas",
  "Orders & accounts",
  "Other",
];

const RULES: [MailGroup, RegExp][] = [
  [
    "Registrar & enrolment",
    /\b(registrar|urecords|reginfo|enrol(?:l)?(?:ment)?|waitlist|transcript|graduation|beedie undergraduate|scheduling|advis(?:ing|or))\b/i,
  ],
  [
    "Money",
    /\b(tuition|fees?|financial aid|scholarships?|bursar(?:y|ies)|awards?|student loans?|invoice|refund|payment)\b/i,
  ],
  [
    "Athletics",
    /\b(athletics|basketball|clan|coach|team manager|practice|roster)\b/i,
  ],
  ["Housing", /\b(residence|housing|res life|facilities)\b/i],
  ["Research credits", /\b(research participation|study credit|rps|sona)\b/i],
  ["Library", /\b(libcirc|library|due items|overdue)\b/i],
  ["Canvas", /\b(canvas|instructure)\b/i],
  [
    "Orders & accounts",
    /\b(eshop|bookstore|order|registration|norton|pearson|mcgraw|account|coverage|insurance|alumo)\b/i,
  ],
];

/** Automatic senders: no-reply addresses, systems and departments. */
const AUTOMATIC =
  /(no-?reply|donotreply|do-not-reply|notifications?|mailer|system|newsletter|news@|info@|communications@|eshop@|libcirc@|urecords@|reginfo@|@instructure\.com)/i;
const DEPARTMENT =
  /\b(sfu|department|office|services|system|university|canvas|residence|housing|staff|team|school|centre|center|program|prep)\b/i;

export function isPerson(sender: string | null) {
  if (!sender) return false;
  if (AUTOMATIC.test(sender)) return false;
  const name = sender
    .replace(/\s*<.*>/, "")
    .replace(/"/g, "")
    .trim();
  // "Kaden Hruska" yes; "SFU Residence & Housing Department" no.
  return (
    /^[A-Z][\p{L}'’-]+(\s+[A-Z]\.?)?(\s+[\p{L}'’-]+){1,3}$/u.test(name) &&
    !DEPARTMENT.test(name)
  );
}

export function mailGroup(m: { title: string; sender: string | null }) {
  const text = `${m.sender ?? ""}\n${m.title}`;
  for (const [group, re] of RULES) if (re.test(text)) return group;
  return isPerson(m.sender) ? "People" : "Other";
}
