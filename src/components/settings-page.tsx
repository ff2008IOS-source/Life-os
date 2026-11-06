"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTheme } from "next-themes";
import {
  Download,
  CalendarDays,
  FileSpreadsheet,
  Pause,
  LogOut,
  FlaskConical,
} from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
export function SettingsPage() {
  const router = useRouter();
  const { data, request, refresh, notify, pending } = useWorkspace();
  const { setTheme } = useTheme();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      await request("/api/v1/profile", {
        method: "PATCH",
        body: JSON.stringify({
          version: data.profile.version,
          data: {
            display_name: f.get("display_name"),
            theme: f.get("theme"),
            density: f.get("density"),
          },
        }),
      });
      await refresh();
      setTheme(String(f.get("theme")));
      notify("Preferences saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MAKE IT YOURS</span>
          <h1>Settings</h1>
          <p>Your preferences, privacy, and connected services.</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="panel settings-panel">
          <h2>Your workspace</h2>
          <p>Preferences are saved to your private account.</p>
          <form onSubmit={submit}>
            <label>
              Display name
              <input
                name="display_name"
                defaultValue={data.profile.display_name}
                maxLength={100}
                placeholder="How should we address you?"
              />
            </label>
            <div className="form-grid">
              <label>
                Appearance
                <select
                  name="theme"
                  defaultValue={data.profile.theme}
                  onChange={(e) => setTheme(e.target.value)}
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                  <option value="system">System</option>
                </select>
              </label>
              <label>
                Density
                <select name="density" defaultValue={data.profile.density}>
                  <option value="comfortable">Comfortable</option>
                  <option value="compact">Compact</option>
                </select>
              </label>
            </div>
            <div className="setting-line">
              <div>
                <strong>Timezone</strong>
                <p>Scheduling and deadlines use Vancouver local time.</p>
              </div>
              <span className="badge">America/Vancouver</span>
            </div>
            {error && (
              <p role="alert" className="error-message">
                {error}
              </p>
            )}
            <Button disabled={saving || !data.areas.length} type="submit">
              {saving ? "Saving…" : "Save preferences"}
            </Button>
            {!data.areas.length && (
              <p className="form-hint">
                Initialize your workspace from Home first.
              </p>
            )}
          </form>
        </section>
        <section className="panel settings-panel">
          <h2>Connected services</h2>
          <p>Real integrations stay behind the Stage B authorization gate.</p>
          <div className="setting-line">
            <div>
              <strong className="inline">
                <CalendarDays size={15} />
                Google Calendar
              </strong>
              <p>Six existing calendars will remain read-only.</p>
            </div>
            <span className="badge">Not connected</span>
          </div>
          <div className="setting-line">
            <div>
              <strong className="inline">
                <FileSpreadsheet size={15} />
                Career spreadsheet
              </strong>
              <p>Read-only import. Mapping must be verified.</p>
            </div>
            <span className="badge">Not connected</span>
          </div>
          <div className="setting-line">
            <div>
              <strong className="inline">
                <Pause size={15} />
                Automatic scheduling
              </strong>
              <p>No unattended scheduling or calendar writes.</p>
            </div>
            <span className="badge amber">Off</span>
          </div>
          <p className="form-hint" style={{ marginTop: 16 }}>
            No credentials have been connected through this application.
          </p>
        </section>
        <section className="panel settings-panel">
          <h2>Privacy & recovery</h2>
          <p>Only your approved account can access your workspace.</p>
          <div className="setting-line">
            <div>
              <strong>Export your records</strong>
              <p>
                Download JSON, excluding credentials. This is not a full
                database backup.
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href="/api/v1/export" download>
                <Download size={13} />
                Export
              </a>
            </Button>
          </div>
          <div className="setting-line">
            <div>
              <strong>Independent backups</strong>
              <p>
                Follow docs/RECOVERY.md. Hosted restoration is not yet verified.
              </p>
            </div>
            <span className="badge amber">Setup needed</span>
          </div>
          <div className="setting-line">
            <div>
              <strong>Push notifications</strong>
              <p>Not enabled. No timed delivery is promised.</p>
            </div>
            <span className="badge">Off</span>
          </div>
          <div className="setting-line">
            <div>
              <strong>Account deletion</strong>
              <p>
                Owner-operated procedure in docs/RECOVERY.md until the secured
                deletion workflow is implemented.
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            style={{ marginTop: 15 }}
            onClick={async () => {
              try {
                await request("/api/v1/auth/logout", { method: "POST" });
                router.push("/login");
                router.refresh();
              } catch (e) {
                notify(e instanceof Error ? e.message : "Unable to sign out");
              }
            }}
          >
            <LogOut size={14} />
            Sign out
          </Button>
        </section>
        <section className="panel settings-panel">
          <h2 className="inline">
            <FlaskConical size={17} />
            Safe beta examples
          </h2>
          <p>
            Add a small, clearly labeled synthetic project, goal, milestone, and
            two tasks. No personal records or external events are created.
            Repeating this action does not duplicate examples.
          </p>
          <Button
            variant="outline"
            disabled={pending || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await request("/api/v1/workspace/examples", { method: "POST" });
                await refresh();
                notify("Clearly labeled test examples added");
              } catch (e) {
                notify(
                  e instanceof Error ? e.message : "Unable to add examples",
                );
              } finally {
                setSaving(false);
              }
            }}
          >
            <FlaskConical size={14} />
            Add [TEST] examples
          </Button>
          <p className="form-hint" style={{ marginTop: 15 }}>
            Finance and Wellbeing remain empty.
          </p>
        </section>
      </div>
    </>
  );
}
