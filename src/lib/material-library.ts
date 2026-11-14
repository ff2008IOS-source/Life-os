export type LibraryRecord = {
  id: string;
  type: string;
  title: string;
  course: string | null;
  module?: string | null;
  text?: string;
};
export function friendlyMaterialTitle(title: string) {
  return title
    .replace(/\.(pdf|docx?|pptx?|xlsx?)$/i, "")
    .replace(/[_+]+/g, " ")
    .replace(/-pdf$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}
export function materialFolder(record: LibraryRecord) {
  if (record.module)
    return {
      key: `module:${record.course}:${record.module}`,
      title: record.module,
      suggested: false,
    };
  const title = record.title.toLowerCase();
  const group =
    record.type === "course" || /syllabus|course.?outline/.test(title)
      ? "Syllabus & course guide"
      : /mock|midterm|final.?exam|exam.?prep/.test(title)
        ? "Exam preparation"
        : /tutorial|practice|solution|answer/.test(title)
          ? "Tutorials & practice"
          : /lecture|slides|week\s*\d/.test(title)
            ? "Lectures by week"
            : /reading|textbook|economy.unit|chapter/.test(title)
              ? "Readings"
              : "Other resources";
  return { key: `suggested:${group}`, title: group, suggested: true };
}
export function groupMaterials<T extends LibraryRecord>(
  records: T[],
  query: string,
) {
  const folders = new Map<
    string,
    { key: string; title: string; suggested: boolean; records: T[] }
  >();
  for (const record of records) {
    if (
      record.type === "page" &&
      records.some(
        (other) =>
          other.type === "page_content" &&
          other.course === record.course &&
          other.id === record.id,
      )
    )
      continue;
    if (
      ["module", "module_item"].includes(record.type) ||
      (record.type === "course" && !record.text?.trim())
    )
      continue;
    if (
      !`${record.title} ${record.module ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase())
    )
      continue;
    const folder = materialFolder(record);
    const value = folders.get(folder.key) ?? { ...folder, records: [] };
    value.records.push(record);
    folders.set(folder.key, value);
  }
  return [...folders.values()]
    .sort(
      (a, b) =>
        Number(b.title.includes("Syllabus")) -
          Number(a.title.includes("Syllabus")) ||
        a.title.localeCompare(b.title, undefined, { numeric: true }),
    )
    .map((folder) => ({
      ...folder,
      records: folder.records.toSorted((a, b) =>
        a.title.localeCompare(b.title, undefined, { numeric: true }),
      ),
    }));
}

export function materialAvailability(status: string, text: string) {
  if (/^(unavailable|unsupported|too_large|no_text|failed)\b/.test(status))
    return "Unavailable";
  if (/^(queued|pending|processing|reading)\b/.test(status))
    return "Processing";
  return text.trim() ? "Ready" : "Open in Canvas";
}
