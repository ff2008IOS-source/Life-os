/** Keep source/audit text out of card copy. Full notes remain available in Edit. */
export function projectSummary(
  name: string,
  description: string,
  imported = false,
) {
  if (
    imported &&
    /Activated from|Imported source|Source:\s*https?:\/\/|Source tab:/i.test(
      description,
    )
  ) {
    if (/recruiting website/i.test(name))
      return "Build a recruiting website for SFU basketball.";
    if (/weekly shooting report/i.test(name))
      return "Create a quick weekly shooting report with an Excel workflow.";
    if (/camp operations/i.test(name))
      return "Document basketball camp operations as a practical case study.";
    if (/Milestone 1/i.test(name))
      return "Clarify basketball operations responsibilities and choose an NBA video topic.";
    if (/Milestone 2/i.test(name))
      return "Publish the first NBA video and an anonymized shooting-report sample.";
    if (/content channel/i.test(name))
      return "Launch an NBA front-office analysis channel with a first transaction breakdown.";
  }
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
