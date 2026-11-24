"use client";
import { ActivityReset } from "./activity-reset";
import { ConnectedSyncAll } from "./connected-sync-all";
import { CanvasConnectionSettings } from "./canvas-panel";
import { NotificationsPanel } from "./notifications-panel";
import { SheetRestPanel } from "./sheet-rest-panel";
import { SheetSyncPanel } from "./sheet-sync-panel";
import Link from "next/link";
import { ProfilePictureSettings } from "./profile-identity";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTheme } from "next-themes";
import { Download, LogOut, FlaskConical } from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import { PasswordForm } from "./password-forms";
import { AccountDeletion } from "./account-deletion";
import { MfaPanel } from "./mfa-panel";
import { NewTermSetup } from "./new-term-setup";
import { TechnicalDetailsToggle } from "./technical-details";
import { CareerPanel } from "./career-panel";
import { GoogleCalendarPanel } from "./google-calendar-panel";
export function SettingsPage({
  initialSection = "profile",
  initialCanvasOpen = false,
}: {
  initialSection?: string;
  initialCanvasOpen?: boolean;
}) {
  const [section, setSection] = useState(
    ["profile", "integrations", "privacy", "advanced"].includes(initialSection)
      ? initialSection
      : "profile",
  );
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
        </div>
      </div>
      <div className="tabs settings-tabs" aria-label="Settings sections">
        {[
          { id: "profile", label: "Preferences" },
          { id: "integrations", label: "Connections" },
          { id: "privacy", label: "Privacy & account" },
          { id: "advanced", label: "Advanced" },
        ].map((t) => (
          <button
            key={t.id}
            className={`tab ${section === t.id ? "active" : ""}`}
            aria-pressed={section === t.id}
            onClick={() => setSection(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="settings-content">
        {section === "profile" && (
          <div>
            <div className="settings-grid">
              <ProfilePictureSettings />
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
                      List density
                      <select
                        name="density"
                        defaultValue={data.profile.density}
                      >
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
            </div>
          </div>
        )}
        {section === "integrations" && (
          <div>
            <ConnectedSyncAll />
            <div className="settings-grid">
              <CanvasConnectionSettings initialOpen={initialCanvasOpen} />
              <GoogleCalendarPanel settings />
              <SheetRestPanel />
              <details className="panel settings-panel">
                <summary>Legacy imports and migration tools</summary>
                <p className="small muted">
                  These preserve earlier imported records. Use Google Sheets
                  synchronization above for current mapped two-way tables.
                </p>
                <CareerPanel compact />
                <SheetSyncPanel />
              </details>
              <section className="panel settings-panel">
                <h2>Planning preferences</h2>
                <p>
                  Work hours, session lengths and calendar reservations live
                  together in Planner.
                </p>
                <Link className="text-link" href="/planner?section=schedule">
                  Open planning controls
                </Link>
              </section>
            </div>
          </div>
        )}
        {section === "privacy" && (
          <div>
            <div className="settings-grid">
              <section className="panel settings-panel">
                <h2>Notifications</h2>
                <p>Manage reminders, quiet hours and device push in Updates.</p>
                <details>
                  <summary>Reminder preferences and devices</summary>
                  <NotificationsPanel />
                </details>
              </section>
              <MfaPanel />
              <PasswordForm />
              <ActivityReset />
              <AccountDeletion />
              <section className="panel settings-panel">
                <h2>Privacy & recovery</h2>
                <Link className="text-link" href="/assistant/history">
                  Past conversations
                </Link>
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
                      Encrypted backups and restoration need separate
                      verification. Hosted recovery is not yet verified. Keep
                      encryption keys separately from the backup.
                    </p>
                  </div>
                  <a
                    className="text-link"
                    href="https://github.com/ff2008IOS-source/Life-os/blob/main/docs/HOSTED_RECOVERY_SETUP.md"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Recovery instructions
                  </a>
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
                      notify(
                        e instanceof Error ? e.message : "Unable to sign out",
                      );
                    }
                  }}
                >
                  <LogOut size={14} />
                  Sign out
                </Button>
              </section>
            </div>
          </div>
        )}
        {section === "advanced" && (
          <div>
            <NewTermSetup />
            <section className="panel settings-panel">
              <h2>Technical details</h2>
              <TechnicalDetailsToggle />
            </section>
            <div className="settings-grid">
              <section className="panel settings-panel">
                <h2 className="inline">
                  <FlaskConical size={17} />
                  Safe beta examples
                </h2>
                <p>
                  Add a small, clearly labeled synthetic project, goal,
                  milestone, and two tasks. No personal records or external
                  events are created. Repeating this action does not duplicate
                  examples.
                </p>
                <Button
                  variant="outline"
                  disabled={pending || saving}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await request("/api/v1/workspace/examples", {
                        method: "POST",
                      });
                      await refresh();
                      notify("Clearly labeled test examples added");
                    } catch (e) {
                      notify(
                        e instanceof Error
                          ? e.message
                          : "Unable to add examples",
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
          </div>
        )}
      </div>
    </>
  );
}
