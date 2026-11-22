import { expect, it } from "vitest";
import {
  defaultLayout,
  displayedWidgets,
  layoutSchema,
  migrateLayout,
  widgetIds,
} from "@/lib/dashboard-layout";
it("keeps all widgets uniquely represented, constrains sizes and keeps focus outside customization", () => {
  for (const preset of ["balanced", "execution", "study"] as const) {
    const d = defaultLayout(preset);
    expect(layoutSchema.safeParse(d).success).toBe(true);
    expect(d.widgets).toHaveLength(widgetIds.length);
    expect(new Set(d.widgets.map((w) => w.id)).size).toBe(widgetIds.length);
  }
  const d = defaultLayout();
  d.widgets[1].id = d.widgets[0].id;
  expect(layoutSchema.safeParse(d).success).toBe(false);
  expect(
    layoutSchema.safeParse({
      ...defaultLayout(),
      widgets: [
        { id: "focus", visible: false, size: "arbitrary", pinned: false },
      ],
    }).success,
  ).toBe(false);
});
it("falls back to the original layout for unknown versions or corrupt settings", () => {
  expect(migrateLayout({ schema: 999 }).mode).toBe("classic");
  expect(migrateLayout(null).mode).toBe("classic");
  expect(migrateLayout(defaultLayout("study"))).toEqual(defaultLayout("study"));
});
it("pins visible widgets while preserving relative order and excludes hidden widgets", () => {
  const d = defaultLayout();
  d.widgets[3].pinned = true;
  d.widgets[0].visible = false;
  const shown = displayedWidgets(d);
  expect(shown[0].id).toBe(d.widgets[3].id);
  expect(shown.some((w) => w.id === d.widgets[0].id)).toBe(false);
});

it("removes retired entries without resetting surviving layout or presets", () => {
  const current = defaultLayout("study");
  current.density = "compact";
  current.widgets[0].size = "wide";
  const retired = {
    id: "basketball",
    visible: true,
    pinned: true,
    size: "standard",
  };
  const old = {
    ...current,
    widgets: [retired, ...current.widgets],
    presets: [
      {
        name: "Saved",
        density: "compact",
        widgets: [...current.widgets, retired],
      },
    ],
  };
  const migrated = migrateLayout(old);
  expect(migrated.widgets).toEqual(current.widgets);
  expect(migrated.density).toBe("compact");
  expect(migrated.presets[0].widgets).toEqual(current.widgets);
});
