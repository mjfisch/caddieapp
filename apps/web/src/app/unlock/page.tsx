"use client";
import { useState } from "react";

// One-time per device (one year): enter the write key so logging, edits and the
// coach work from this browser. Reads never need it.
export default function UnlockPage() {
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg("Checking…");
    const res = await fetch("/api/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    setKey("");
    setMsg(res.ok ? "This device is unlocked for one year." : res.status === 503 ? "Writes are locked: the key is not configured on the server." : "Wrong key.");
  }
  async function lock() {
    await fetch("/api/unlock", { method: "DELETE" });
    setMsg("This device is locked again.");
  }
  return (
    <main style={{ maxWidth: 420, margin: "48px auto", padding: "0 20px" }}>
      <h1>Unlock This Device</h1>
      <p>Logging practice, editing rounds and the coach need the write key once per device.</p>
      <form onSubmit={submit}>
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="current-password"
          aria-label="Write key" style={{ width: "100%", padding: 12, fontSize: 16 }} />
        <button type="submit" style={{ marginTop: 12, padding: "10px 16px", fontSize: 16 }}>Unlock</button>
      </form>
      <button type="button" onClick={lock} style={{ marginTop: 12, padding: "8px 14px" }}>Lock This Device</button>
      {msg && <p role="status">{msg}</p>}
    </main>
  );
}
