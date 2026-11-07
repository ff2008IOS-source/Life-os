"use client";
import { useEffect, useState } from "react";
export default function CanvasConnect() {
  const [token, setToken] = useState("");
  const [expiry, setExpiry] = useState("");
  const [status, setStatus] = useState("Checking connection…");
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/canvas/connection").then(r => r.json()).then(d => setStatus(d.connected ? "Connected. Expires: " + d.expires_at + (d.last_sync_at ? " · Last sync: " + d.last_sync_at : "") : "Not connected")).catch(() => setStatus("Unable to check connection")); }, []);
  async function connect() {
    setBusy(true);
    try {
      const r = await fetch("/api/canvas/connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, expires_at: new Date(expiry + "T23:59:59").toISOString() }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setToken(""); setStatus("Connected to Canvas. Found " + d.course_count + " courses.");
    } catch (e) { setStatus(e instanceof Error ? e.message : "Connection failed"); }
    finally { setBusy(false); }
  }
  async function sync() {
    setBusy(true);
    try {
      const r = await fetch("/api/canvas/sync", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setStatus("Imported " + d.synced + " records across " + d.courses + " courses.");
    } catch (e) { setStatus(e instanceof Error ? e.message : "Sync failed"); }
    finally { setBusy(false); }
  }
  return <main style={{ maxWidth: 560, margin: "64px auto", padding: 24 }}>
    <h1 style={{ fontSize: 28, fontWeight: 700 }}>SFU Canvas connection</h1>
    <p>Enter your personal Canvas token here. Never put it in GitHub or chat. Replace it every 30 days.</p>
    <p role="status" style={{ margin: "24px 0" }}>{status}</p>
    <form onSubmit={e => { e.preventDefault(); void connect(); }} style={{ display: "grid", gap: 14 }}>
      <label>Canvas access token<input type="password" autoComplete="off" required value={token} onChange={e => setToken(e.target.value)} style={{ display: "block", width: "100%", color: "#111", padding: 8 }} /></label>
      <label>Token expiry date<input type="date" required value={expiry} onChange={e => setExpiry(e.target.value)} style={{ display: "block", color: "#111", padding: 8 }} /></label>
      <button disabled={busy || !token || !expiry} type="submit">Save and verify connection</button>
    </form>
    <button disabled={busy} onClick={() => void sync()} style={{ marginTop: 24 }}>Sync now</button>
  </main>;
}
