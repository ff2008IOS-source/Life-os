import { createHash } from "node:crypto";
import type { SheetSnapshot } from "./sheets-server";
export type CareerMappedRow = {
  kind: string;
  title: string;
  status: string;
  details: Record<string, string | null>;
  source_key: string;
};
/** Source rows are data, not instructions. Headers/ranges were inspected before defining these templates. */
const templates = [
  {
    tab: "Network & Applications",
    header: 4,
    start: 0,
    end: 6,
    title: "Name",
    kind: "contact",
    keys: ["Name"],
  },
  {
    tab: "Semester Plan",
    header: 3,
    start: 0,
    end: 10,
    title: "Goal",
    kind: "career_goal",
    keys: ["Semester", "Area", "Goal"],
  },
  {
    tab: "4-Year Roadmap",
    header: 3,
    start: 0,
    end: 9,
    title: "Mission",
    kind: "roadmap",
    keys: ["Year"],
  },
  {
    tab: "Internship & Co-op Roadmap",
    header: 3,
    start: 0,
    end: 11,
    title: "Primary Objective",
    kind: "roadmap",
    keys: ["Term"],
  },
  {
    tab: "Network & Applications",
    header: 4,
    start: 7,
    end: 11,
    title: "Organization / Role",
    kind: "application_target",
    keys: ["Organization / Role"],
  },
  {
    tab: "Skills & Portfolio",
    header: 4,
    start: 0,
    end: 6,
    title: "Skill",
    kind: "skill",
    keys: ["Skill"],
  },
  {
    tab: "Skills & Portfolio",
    header: 4,
    start: 7,
    end: 10,
    title: "Project",
    kind: "portfolio_project",
    keys: ["Project"],
  },
  {
    tab: "Weekly Review",
    header: 3,
    start: 0,
    end: 10,
    title: "Week Of",
    kind: "review",
    keys: ["Week Of"],
  },
] as const;
export function mapCareerSnapshot(snapshot: SheetSnapshot) {
  const records: CareerMappedRow[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  const mappingHeaders = [];
  for (const template of templates) {
    const tab = snapshot.tabs.find((t) => t.title === template.tab);
    if (!tab) {
      errors.push(`Missing source tab: ${template.tab}`);
      continue;
    }
    const headers = (tab.values[template.header] ?? [])
      .slice(template.start, template.end)
      .map((x) => String(x ?? "").trim());
    if (
      !headers.includes(template.title) ||
      template.keys.some((k) => !headers.includes(k)) ||
      headers.some((h) => !h) ||
      new Set(headers).size !== headers.length
    ) {
      errors.push(
        `Headers changed in ${template.tab}. Revalidate this mapping.`,
      );
      continue;
    }
    mappingHeaders.push([tab.id, template.start, headers]);
    for (const row of tab.values.slice(template.header + 1)) {
      const values = row.slice(template.start, template.end);
      const details = Object.fromEntries(
        headers.map((h, i) => [
          h,
          values[i] == null || values[i] === "" ? null : String(values[i]),
        ]),
      );
      const title = details[template.title];
      if (!title?.trim()) continue;
      if (title.length > 300) {
        errors.push(`Source title is too long in ${template.tab}.`);
        continue;
      }
      const key = JSON.stringify([
        snapshot.id,
        tab.id,
        template.kind,
        ...template.keys.map((k) => details[k]?.trim() ?? ""),
      ]);
      if (seen.has(key)) {
        errors.push(
          `Duplicate source identity in ${template.tab}. Review duplicate titles before importing.`,
        );
        continue;
      }
      seen.add(key);
      records.push({
        kind: template.kind,
        title: title.trim(),
        status: details.Status ?? "unknown",
        details: {
          ...details,
          "Source tab": tab.title,
          Verification: "Source-reported; not independently verified",
        },
        source_key: key,
      });
    }
  }
  return {
    records,
    errors,
    schemaFingerprint: createHash("sha256")
      .update(JSON.stringify(mappingHeaders))
      .digest("hex"),
  };
}
