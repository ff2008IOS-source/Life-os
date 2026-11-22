/** Keep source/audit text out of card copy. Full notes remain available in Edit. */
export function projectSummary(
  name: string,
  description: string,
  imported = false,
) {
  void imported;
  const clean = description
    .replace(/https?:\/\/\S+/g, "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s &&
        !/^(Activated from|Imported source|Source:|Source tab:|Verification:|Status:|Target Date:|Project:)/i.test(
          s,
        ),
    )
    .join(" ");
  const text = clean || name;
  return text.length > 155
    ? text.slice(0, 152).replace(/\s+\S*$/, "") + "…"
    : text;
}
