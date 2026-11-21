"use client";
import { useState } from "react";
import {
  defaultLayout,
  layoutSchema,
  widgetNames,
  type DashboardLayout,
} from "@/lib/dashboard-layout";
import { useWorkspace } from "./workspace-provider";
import { calendarRequest } from "./use-calendar";
import { Button } from "./ui/button";
import { Modal } from "./dialog";
const fixedWidgets = ["plan", "schedule", "upcoming", "review"];
export function DashboardCustomizer() {
  const { data, refresh } = useWorkspace();
  const [draft, setDraft] = useState<DashboardLayout | null>(null);
  const [version, setVersion] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [presetName, setPresetName] = useState("");
  const [announcement, setAnnouncement] = useState("");
  async function open() {
    setError("");
    setBusy(true);
    try {
      const r = await calendarRequest<{
        settings: DashboardLayout;
        version: number;
      }>("/api/v1/dashboard/preferences");
      setDraft(r.settings);
      setVersion(r.version);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Dashboard settings could not load.",
      );
    } finally {
      setBusy(false);
    }
  }
  function changeWidget(
    index: number,
    values: Partial<DashboardLayout["widgets"][number]>,
  ) {
    if (draft)
      setDraft({
        ...draft,
        widgets: draft.widgets.map((w, i) =>
          i === index ? { ...w, ...values } : w,
        ),
      });
  }
  const editablePositions =
    draft?.widgets.flatMap((w, i) =>
      fixedWidgets.includes(w.id) ? [] : [i],
    ) ?? [];
  function move(index: number, step: number) {
    if (!draft) return;
    const position = editablePositions.indexOf(index),
      target = editablePositions[position + step];
    if (target === undefined) return;
    const widgets = [...draft.widgets];
    [widgets[index], widgets[target]] = [widgets[target], widgets[index]];
    setDraft({ ...draft, widgets });
    setAnnouncement(
      `${widgetNames[widgets[target].id]} moved to position ${position + step + 1} of ${editablePositions.length}.`,
    );
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      await calendarRequest("/api/v1/dashboard/preferences", {
        method: "PUT",
        body: JSON.stringify({ version, settings: layoutSchema.parse(draft) }),
      });
      await refresh();
      setDraft(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Your layout could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void open()}
        disabled={busy || data.dashboard?.enabled === false}
      >
        Customize dashboard
      </Button>
      {error && !draft && <p role="alert">{error}</p>}
      {draft && (
        <Modal
          title="Your dashboard"
          description="Daily Focus stays at the top. Your layout is saved to your account when you press Save dashboard."
          open={true}
          onOpenChange={(open) => {
            if (!open && !busy) setDraft(null);
          }}
        >
          <div className="dashboard-customizer stack">
            <p role="status" className="small muted">
              {announcement}
            </p>
            <label>
              Dashboard style
              <select
                value={draft.mode}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    mode: e.target.value as DashboardLayout["mode"],
                  })
                }
              >
                <option value="classic">Essentials</option>
                <option value="custom">Custom sections</option>
              </select>
            </label>
            <label>
              Layout preset
              <select
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  const next = defaultLayout(
                    e.target.value as "balanced" | "execution" | "study",
                  );
                  setDraft({ ...next, presets: draft.presets });
                }}
              >
                <option value="">Choose a preset</option>
                <option value="balanced">Balanced</option>
                <option value="execution">Execution</option>
                <option value="study">Study</option>
              </select>
            </label>
            {draft.presets.length > 0 && (
              <label>
                Saved layouts
                <select
                  value=""
                  onChange={(e) => {
                    const p = draft.presets[Number(e.target.value)];
                    if (e.target.value && p)
                      setDraft({
                        ...draft,
                        mode: "custom",
                        widgets: p.widgets,
                        density: p.density,
                      });
                  }}
                >
                  <option value="">Choose a saved layout</option>
                  {draft.presets.map((p, i) => (
                    <option key={i} value={String(i)}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="form-grid">
              <label>
                Card spacing
                <select
                  disabled={draft.mode === "classic"}
                  value={draft.density}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      density: e.target.value as DashboardLayout["density"],
                    })
                  }
                >
                  <option value="compact">Compact</option>
                  <option value="balanced">Balanced</option>
                  <option value="spacious">Spacious</option>
                </select>
              </label>
              <label>
                Accent
                <select
                  value={draft.accent}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      accent: e.target.value as DashboardLayout["accent"],
                    })
                  }
                >
                  <option value="indigo">Sage</option>
                  <option value="blue">Slate</option>
                  <option value="violet">Clay</option>
                </select>
              </label>
            </div>
            {draft.mode === "custom" && (
              <fieldset>
                <legend>Additional sections</legend>
                <p className="small muted">
                  Pinned widgets appear first. Wide cards fill the desktop row;
                  phones keep one column.
                </p>
                {draft.widgets.map((w, i) =>
                  fixedWidgets.includes(w.id) ? null : (
                    <div className="widget-control" key={w.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={w.visible}
                          onChange={(e) =>
                            changeWidget(i, { visible: e.target.checked })
                          }
                        />
                        {widgetNames[w.id]}
                      </label>
                      <div className="widget-control-actions">
                        <label>
                          <input
                            type="checkbox"
                            checked={w.pinned}
                            onChange={(e) =>
                              changeWidget(i, { pinned: e.target.checked })
                            }
                          />{" "}
                          Pin {widgetNames[w.id]}
                        </label>
                        <select
                          aria-label={`${widgetNames[w.id]} size`}
                          value={w.size}
                          onChange={(e) =>
                            changeWidget(i, {
                              size: e.target.value as "standard" | "wide",
                            })
                          }
                        >
                          <option value="standard">Standard</option>
                          <option value="wide">Wide</option>
                        </select>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={i === editablePositions[0]}
                          aria-label={`Move ${widgetNames[w.id]} up`}
                          onClick={() => move(i, -1)}
                        >
                          ↑
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={i === editablePositions.at(-1)}
                          aria-label={`Move ${widgetNames[w.id]} down`}
                          onClick={() => move(i, 1)}
                        >
                          ↓
                        </Button>
                      </div>
                    </div>
                  ),
                )}
              </fieldset>
            )}
            <label>
              Save layout as
              <input
                value={presetName}
                maxLength={32}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="For example, exam week"
              />
            </label>
            <Button
              variant="outline"
              disabled={
                !presetName.trim() ||
                draft.presets.length >= 5 ||
                draft.presets.some((p) => p.name === presetName.trim())
              }
              onClick={() => {
                setDraft({
                  ...draft,
                  presets: [
                    ...draft.presets,
                    {
                      name: presetName.trim(),
                      density: draft.density,
                      widgets: draft.widgets.map((w) => ({ ...w })),
                    },
                  ],
                });
                setPresetName("");
              }}
            >
              Save preset
            </Button>
            {draft.presets.map((p, i) => (
              <div className="flex-between" key={i}>
                <span>{p.name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      presets: draft.presets.filter((_, j) => i !== j),
                    })
                  }
                >
                  Remove {p.name}
                </Button>
              </div>
            ))}
            {error && (
              <p role="alert" className="error-message">
                {error}{" "}
                <Button variant="ghost" size="sm" onClick={() => void open()}>
                  Reload settings
                </Button>
              </p>
            )}
            <div className="dialog-actions">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  setDraft({
                    ...defaultLayout(),
                    mode: "classic",
                    presets: draft.presets,
                  })
                }
              >
                Reset layout
              </Button>
              <Button disabled={busy} onClick={() => void save()}>
                {busy ? "Saving…" : "Save dashboard"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
