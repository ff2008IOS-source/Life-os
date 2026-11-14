/** Hidden areas keep their records; only everyday navigation and creation change. */
export function visibleArea(area: { slug: string }) {
  return !["finances", "finance", "wellbeing", "well-being"].includes(
    area.slug,
  );
}
export function availableProject(project: {
  archived_at?: string | null;
  deleted_at?: string | null;
}) {
  return !project.archived_at && !project.deleted_at;
}
