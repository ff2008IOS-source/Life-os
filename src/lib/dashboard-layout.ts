import { z } from "zod";
export const widgetIds = [
  "plan",
  "schedule",
  "upcoming",
  "goals",
  "review",
  "academics",
  "career",
  "learning",
  "projects",
  "insights",
  "sessions",
] as const;
export type WidgetId = (typeof widgetIds)[number];
export const widgetNames: Record<WidgetId, string> = {
  plan: "Today’s tasks",
  schedule: "Today’s schedule",
  upcoming: "Upcoming",
  goals: "Goals",
  review: "Weekly review",
  academics: "Academics",
  career: "Career",
  learning: "Learning",
  projects: "Projects",
  insights: "Progress",
  sessions: "Work sessions",
};
const widget = z
  .object({
    id: z.enum(widgetIds),
    visible: z.boolean(),
    size: z.enum(["standard", "wide"]),
    pinned: z.boolean(),
  })
  .strict();
export const layoutSchema = z
  .object({
    schema: z.literal(1),
    mode: z.enum(["classic", "custom"]),
    density: z.enum(["compact", "balanced", "spacious"]),
    accent: z.enum(["indigo", "blue", "violet"]),
    greeting: z.boolean(),
    banner: z.boolean(),
    presets: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(32),
            density: z.enum(["compact", "balanced", "spacious"]),
            widgets: z.array(widget).length(widgetIds.length),
          })
          .strict(),
      )
      .max(5)
      .default([]),
    widgets: z
      .array(widget)
      .length(widgetIds.length)
      .refine(
        (rows) => new Set(rows.map((r) => r.id)).size === widgetIds.length,
        "Every widget must appear exactly once",
      ),
  })
  .strict();
export type DashboardLayout = z.infer<typeof layoutSchema>;
export function defaultLayout(
  preset: "balanced" | "execution" | "study" = "balanced",
): DashboardLayout {
  const preferred: WidgetId[] =
    preset === "execution"
      ? [
          "plan",
          "sessions",
          "schedule",
          "upcoming",
          "projects",
          "goals",
          "review",
        ]
      : preset === "study"
        ? [
            "academics",
            "schedule",
            "plan",
            "learning",
            "upcoming",
            "sessions",
            "review",
          ]
        : [
            "plan",
            "schedule",
            "upcoming",
            "academics",
            "career",
            "review",
            "projects",
            "learning",
            "goals",
            "insights",
            "sessions",
          ];
  const ids = [
    ...preferred,
    ...widgetIds.filter((id) => !preferred.includes(id)),
  ];
  return {
    schema: 1,
    mode: "custom",
    density: "balanced",
    accent: "indigo",
    greeting: true,
    banner: false,
    presets: [],
    widgets: ids.map((id) => ({
      id,
      visible: preset === "balanced" || preferred.includes(id),
      size: "standard",
      pinned: false,
    })),
  };
}
/** Unknown or corrupt layouts never replace the safe baseline. Newly added widgets receive defaults. */
export function migrateLayout(value: unknown): DashboardLayout {
  const cleaned =
    value && typeof value === "object"
      ? ({ ...value } as Record<string, unknown>)
      : value;
  if (cleaned && typeof cleaned === "object") {
    const c = cleaned as Record<string, unknown>;
    const surviving = (rows: unknown) =>
      Array.isArray(rows)
        ? rows.filter(
            (row) =>
              !(row && typeof row === "object" && row.id === "basketball"),
          )
        : rows;
    c.widgets = surviving(c.widgets);
    if (Array.isArray(c.presets))
      c.presets = c.presets.map((p) =>
        p && typeof p === "object"
          ? { ...p, widgets: surviving(p.widgets) }
          : p,
      );
  }
  const parsed = layoutSchema.safeParse(cleaned);
  return parsed.success ? parsed.data : { ...defaultLayout(), mode: "classic" };
}
export function displayedWidgets(layout: DashboardLayout) {
  return [
    ...layout.widgets.filter((w) => w.visible && w.pinned),
    ...layout.widgets.filter((w) => w.visible && !w.pinned),
  ];
}
