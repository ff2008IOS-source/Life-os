"use client";
import { useEffect, useState, useCallback } from "react";
import { Button } from "./ui/button";
import { calendarRequest } from "./use-calendar";
import { NOTIFICATION_CATEGORIES } from "@/lib/notification-rules";
type Preference = {
  category: string;
  in_app_enabled: boolean;
  push_enabled: boolean;
  quiet_start: string | null;
  quiet_end: string | null;
};
type Data = {
  notifications: {
    id: string;
    title: string;
    body: string;
    acknowledged_at: string | null;
  }[];
  preferences: Preference[];
  device_count: number;
  push_public_key: string | null;
};
export function NotificationsPanel() {
  const [limit, setLimit] = useState(8);
  const [data, setData] = useState<Data | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const reload = useCallback(
    async () => setData(await calendarRequest<Data>("/api/v1/notifications")),
    [],
  );
  useEffect(() => {
    let live = true;
    void calendarRequest<Data>("/api/v1/notifications")
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setMessage(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await work();
      await reload();
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Notification request failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function post(body: unknown) {
    return calendarRequest("/api/v1/notifications", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
  return (
    <div className="stack">
      <section className="panel settings-panel">
        <div className="academic-toolbar">
          <h2>Notifications</h2>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await post({ action: "refresh" });
              })
            }
          >
            Check reminders
          </Button>
        </div>
        <p className="muted small">
          Deadline reminders, integration issues, conflicts and weekly reviews.
          Device notifications show a private summary. Delivery depends on your
          device and network.
        </p>
        <details>
          <summary className="text-link">
            Notification settings & devices
          </summary>
          {NOTIFICATION_CATEGORIES.map((category) => {
            const p = data?.preferences.find(
              (p) => p.category === category,
            ) ?? {
              category,
              in_app_enabled: true,
              push_enabled: false,
              quiet_start: "22:00:00",
              quiet_end: "08:00:00",
            };
            return (
              <form
                className="notification-preference"
                key={category}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void act(async () => {
                    await post({
                      action: "preferences",
                      category,
                      in_app_enabled: f.has("in_app"),
                      push_enabled: f.has("push"),
                      quiet_start: f.get("quiet_start") || null,
                      quiet_end: f.get("quiet_end") || null,
                    });
                  });
                }}
              >
                <strong>{category.replaceAll("_", " ")}</strong>
                <label>
                  <input
                    type="checkbox"
                    name="in_app"
                    defaultChecked={p.in_app_enabled}
                  />
                  In app
                </label>
                <label>
                  <input
                    type="checkbox"
                    name="push"
                    defaultChecked={p.push_enabled}
                  />
                  Push
                </label>
                <label>
                  Quiet from
                  <input
                    name="quiet_start"
                    type="time"
                    defaultValue={p.quiet_start?.slice(0, 5) ?? ""}
                  />
                </label>
                <label>
                  Until
                  <input
                    name="quiet_end"
                    type="time"
                    defaultValue={p.quiet_end?.slice(0, 5) ?? ""}
                  />
                </label>
                <Button size="sm" variant="outline" disabled={busy}>
                  Save
                </Button>
              </form>
            );
          })}
          <div className="career-import-actions">
            <Button
              disabled={busy || !data?.push_public_key}
              onClick={() =>
                void act(async () => {
                  if (
                    !("serviceWorker" in navigator) ||
                    !("PushManager" in window)
                  )
                    throw Error(
                      "On iPad: Share → Add to Home Screen, then open Life OS from its new icon to enable push.",
                    );
                  const permission = await Notification.requestPermission();
                  if (permission !== "granted")
                    throw Error(
                      "Notification permission was not granted. Enable it in device settings if you want push.",
                    );
                  await navigator.serviceWorker.register("/sw.js");
                  const registration = await navigator.serviceWorker.ready;
                  const key = data!
                    .push_public_key!.replace(/-/g, "+")
                    .replace(/_/g, "/");
                  const bytes = Uint8Array.from(atob(key), (c) =>
                    c.charCodeAt(0),
                  );
                  const subscription = await registration.pushManager.subscribe(
                    {
                      userVisibleOnly: true,
                      applicationServerKey: bytes,
                    },
                  );
                  await post({
                    action: "subscribe",
                    subscription: subscription.toJSON(),
                  });
                  setMessage(
                    "Device connected. Enable Push for a category above, then send a test.",
                  );
                })
              }
            >
              Enable push on this device
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const r = (await post({ action: "test" })) as {
                    sent: number;
                  };
                  setMessage(
                    r.sent
                      ? "Test sent to your push provider. Check the device."
                      : "Test added in app. Enable integration push and connect a device to test delivery.",
                  );
                })
              }
            >
              Send test
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  if (!("serviceWorker" in navigator)) return;
                  const r =
                    await navigator.serviceWorker.getRegistration("/sw.js");
                  const s = await r?.pushManager.getSubscription();
                  if (s) {
                    await post({ action: "unsubscribe", endpoint: s.endpoint });
                    await s.unsubscribe();
                  }
                  setMessage("Push disabled on this device.");
                })
              }
            >
              Disable this device
            </Button>
          </div>
          <p className="form-hint">
            {data?.device_count ?? 0} connected devices. Quiet hours use
            Vancouver time. Add Life OS to your iPad Home Screen before enabling
            push.
          </p>
        </details>
        {message && (
          <p role="status" className="form-hint">
            {message}
          </p>
        )}
      </section>
      <section className="panel settings-panel">
        <h2>Recent updates</h2>
        {data?.notifications.slice(0, limit).map((n) => (
          <div className="setting-line" key={n.id}>
            <div>
              <strong>{n.title}</strong>
              <p>{n.body}</p>
            </div>
            {!n.acknowledged_at && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await post({ action: "acknowledge", id: n.id });
                  })
                }
              >
                Mark read
              </Button>
            )}
          </div>
        ))}
        {data && data.notifications.length > limit && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLimit((n) => n + 8)}
          >
            Show more updates
          </Button>
        )}
        {!data?.notifications.length && (
          <p className="muted small">No reminders yet.</p>
        )}
      </section>
    </div>
  );
}
