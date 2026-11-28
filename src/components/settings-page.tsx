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
import { startTour, TOUR } from "./guided-tour";
import { CanvasKeyCountdown } from "./canvas-key-countdown";
import { Compass } from "lucide-react";
import {
  DensityPicker,
  ExportReceipt,
  LockChecklist,
  SettingsSummary,
  SignalRows,
  StoredBar,
  Switchboard,
  ThemePicker,
  useSettingsOverview,
} from "./settings-visuals";

/** Where each connection's controls live on the Connections tab. */
const SERVICE_ANCHOR: Record<string, string> = {
  calendar: "st-calendar",
  canvas: "st-canvas",
  email: "st-email",
  ai: "ai-review",
  sheets: "st-sheets",
};
const reveal = (id: string) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.add("st-flash");
  setTimeout(() => el.classList.remove("st-flash"), 1600);
};
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
  const { overview, reload } = useSettingsOverview();
  const openService = (id: string) =>
    requestAnimationFrame(() => reveal(SERVICE_ANCHOR[id] ?? id));
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
          <SettingsSummary overview={overview} />
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
        ].map((t) => {
          const alert = overview?.alerts[t.id] ?? null;
          return (
            <button
              key={t.id}
              className={`tab ${section === t.id ? "active" : ""}`}
              aria-pressed={section === t.id}
              onClick={() => setSection(t.id)}
              title={alert ?? undefined}
            >
              {t.label}
              {alert && (
                <>
                  <i className="st-dot" aria-hidden />
                  <span className="sr-only"> (needs attention)</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      <div className="settings-content">
        {section === "profile" && (
          <div>
            <div className="settings-grid">
              <ProfilePictureSettings />
              <section
                className="panel settings-panel st-tutorial"
                aria-label="Tutorial"
              >
                <h2>
                  <Compass size={18} aria-hidden /> New here, or forgot
                  something?
                </h2>
                <p className="small muted">
                  A guided walk through every page: {TOUR.length} short stops,
                  each showing the real thing and how to use it. Leave any time
                  with End tour or Esc.
                </p>
                <Button onClick={startTour}>Take me on a tutorial</Button>
              </section>
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
                  <ThemePicker
                    value={data.profile.theme}
                    onPick={(t) => setTheme(t)}
                  />
                  <DensityPicker value={data.profile.density} />
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
            <div className="st-connections-top">
              <Switchboard overview={overview} onOpen={openService} />
              <SignalRows overview={overview} onOpen={openService} />
            </div>
            <ConnectedSyncAll />
            <h2 className="settings-group" id="st-calendar">
              Calendar
            </h2>
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
            <h2 className="settings-group" id="st-canvas">
              Academic integrations
            </h2>
            <CanvasKeyCountdown />
            <div className="settings-grid">
              <CanvasConnectionSettings initialOpen={initialCanvasOpen} />
            </div>
            <NewTermSetup />
            <div className="settings-grid" id="st-email">
              <CourseEmailSetup />
            </div>
            <h2 className="settings-group" id="st-sheets">
              Spreadsheets
            </h2>
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
            <LockChecklist
              checks={overview?.security}
              onFix={() => requestAnimationFrame(() => reveal("st-mfa"))}
            />
            <div className="settings-grid">
              <div id="st-mfa">
                <MfaPanel />
              </div>
              <PasswordForm />
              <section className="panel settings-panel">
                <h2>Sign out</h2>
                <p>Signs you out on this device.</p>
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
            <section className="st-danger" aria-labelledby="st-danger-title">
              <h2 id="st-danger-title">Can&rsquo;t be undone</h2>
              <AccountDeletion />
            </section>
          </div>
        )}
        {section === "data" && (
          <div>
            <div className="settings-grid">
              <section className="panel settings-panel st-data">
                <h2>What Life OS holds for you</h2>
                <StoredBar overview={overview} />
                <div className="setting-line">
                  <div>
                    <strong>Export your records</strong>
                    <p>A JSON download of your workspace, without passwords.</p>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href="/api/v1/export"
                      download
                      onClick={() => {
                        // The receipt is saved when the export finishes.
                        for (const ms of [4000, 12000])
                          setTimeout(() => void reload(), ms);
                      }}
                    >
                      <Download size={13} />
                      Export
                    </a>
                  </Button>
                </div>
                <ExportReceipt overview={overview} />
              </section>
              <section className="panel settings-panel">
                <h2>Backups and history</h2>
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
