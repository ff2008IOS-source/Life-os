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
import { Download, LogOut } from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import { PasswordForm } from "./password-forms";
import { AccountDeletion } from "./account-deletion";
import { MfaPanel } from "./mfa-panel";
import { NewTermSetup } from "./new-term-setup";
import { CourseEmailSetup } from "./course-email-setup";
import { SchedulingPanel } from "./scheduling-panel";
import { WorkSessionsPanel } from "./work-sessions-panel";
import { OccurrencesPanel } from "./occurrences-panel";
import { TechnicalDetailsToggle } from "./technical-details";
import { CareerImportPanel } from "./career-import-panel";
import { ConnectedCareerRecords } from "./connected-career-records";
import { GoogleCalendarPanel } from "./google-calendar-panel";
import { AiReviewSettings } from "./ai-review-settings";
export function SettingsPage({
  initialSection = "profile",
  initialCanvasOpen = false,
}: {
  initialSection?: string;
  initialCanvasOpen?: boolean;
}) {
  // Account · Connections · Planning · Notifications · Privacy & security · Data.
  // Older links (?section=advanced) open the tab that now holds that content.
  const [section, setSection] = useState(
    initialSection === "advanced"
      ? "integrations"
      : [
            "profile",
            "integrations",
            "planning",
            "notifications",
            "privacy",
            "data",
          ].includes(initialSection)
        ? initialSection
        : "profile",
  );
  // A link to another section while Settings is open switches the tab.
  const [linked, setLinked] = useState(initialSection);
  if (initialSection !== linked) {
    setLinked(initialSection);
    if (
      [
        "profile",
        "integrations",
        "planning",
        "notifications",
        "privacy",
        "data",
      ].includes(initialSection ?? "")
    )
      setSection(initialSection!);
  }
  const router = useRouter();
  const { data, request, refresh, notify } = useWorkspace();
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
          <h1>Settings</h1>
        </div>
      </div>
      <div className="tabs settings-tabs" aria-label="Settings sections">
        {[
          { id: "profile", label: "Account" },
          { id: "integrations", label: "Connections" },
          { id: "planning", label: "Planning" },
          { id: "notifications", label: "Notifications" },
          { id: "privacy", label: "Privacy & security" },
          { id: "data", label: "Data" },
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
                <h2>Preferences</h2>
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
                      <strong>Time zone</strong>
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
            <h2 className="settings-group">Calendar</h2>
            <div className="settings-grid">
              <GoogleCalendarPanel settings />
              <section className="panel settings-panel">
                <h2>Planning preferences</h2>
                <p>Work hours, session lengths and calendar reservations.</p>
                <Link className="text-link" href="/settings?section=planning">
                  Open planning controls
                </Link>
              </section>
            </div>
            <h2 className="settings-group">AI</h2>
            <div className="settings-grid">
              <AiReviewSettings />
            </div>
            <h2 className="settings-group">Academic integrations</h2>
            <div className="settings-grid">
              <CanvasConnectionSettings initialOpen={initialCanvasOpen} />
            </div>
            <NewTermSetup />
            <div className="settings-grid">
              <CourseEmailSetup />
            </div>
            <h2 className="settings-group">Spreadsheets</h2>
            <div className="settings-grid">
              <CareerImportPanel />
              <SheetRestPanel />
              <details className="panel settings-panel">
                <summary>Connected plan details</summary>
                <p className="small muted">
                  Rows of the optional spreadsheet mirror. Your career records
                  live in Growth → Career; nothing here is needed to use them.
                </p>
                <ConnectedCareerRecords />
              </details>
              <details className="panel settings-panel">
                <summary>Legacy imports and migration tools</summary>
                <p className="small muted">
                  Records imported before two-way sync. New tables use Google
                  Sheets above.
                </p>
                <SheetSyncPanel />
              </details>
            </div>
          </div>
        )}
        {section === "planning" && (
          <>
            <SchedulingPanel />
            <WorkSessionsPanel />
            <OccurrencesPanel />
          </>
        )}
        {section === "notifications" && (
          <div className="settings-grid">
            <section className="panel settings-panel">
              <h2>Reminders</h2>
              <NotificationsPanel />
            </section>
          </div>
        )}
        {section === "privacy" && (
          <div>
            <div className="settings-grid">
              <MfaPanel />
              <PasswordForm />
              <AccountDeletion />
              <section className="panel settings-panel">
                <h2>Sign out</h2>
                <p>Only your account can open your workspace.</p>
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
        {section === "data" && (
          <div>
            <div className="settings-grid">
              <section className="panel settings-panel">
                <h2>Your data</h2>
                <div className="setting-line">
                  <div>
                    <strong>Export your records</strong>
                    <p>A JSON download of your workspace, without passwords.</p>
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
                    <strong>Backups</strong>
                    <p>
                      Encrypted backups are set up separately. Restoring one
                      hasn’t been tested on the hosted site yet.
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
                <div className="setting-line">
                  <div>
                    <strong>Past conversations</strong>
                  </div>
                  <Link className="text-link" href="/assistant/history">
                    Open archive
                  </Link>
                </div>
              </section>
              <ActivityReset />
              <section className="panel settings-panel">
                <h2>Technical details</h2>
                <TechnicalDetailsToggle />
              </section>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
