"use client";

import { useState } from "react";
import Link from "next/link";
import { CONFIDENCE_COLOR, type ConfidenceFlag } from "@gai/shared";

type HealthState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; message: string; dbTime: string; sgEngineVersion: string }
  | { status: "error"; error: string };

const FLAGS: { flag: ConfidenceFlag; label: string }[] = [
  { flag: "measured", label: "measured" },
  { flag: "partial", label: "partial" },
  { flag: "seeded", label: "seeded" },
];

// The dispersion mark — the SG engine drawn small (ellipse + aim dot + landing dot).
function DispersionMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="GAI Caddie">
      <g transform="rotate(-22 32 32)">
        <ellipse cx="32" cy="32" rx="20" ry="11.5" fill="none" stroke="var(--green)" strokeWidth="3.2" />
        <ellipse cx="32" cy="32" rx="11.5" ry="6.6" fill="none" stroke="var(--green)" strokeWidth="3.2" />
      </g>
      <circle cx="32" cy="32" r="3.2" fill="var(--green)" />
      <circle cx="42" cy="27.6" r="2.4" fill="var(--green)" />
    </svg>
  );
}

export default function Home() {
  const [health, setHealth] = useState<HealthState>({ status: "idle" });

  async function ping() {
    setHealth({ status: "loading" });
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      if (data.ok) {
        setHealth({
          status: "ok",
          message: data.message,
          dbTime: data.dbTime,
          sgEngineVersion: data.sgEngineVersion,
        });
      } else {
        setHealth({ status: "error", error: data.error ?? "unknown error" });
      }
    } catch (err) {
      setHealth({ status: "error", error: err instanceof Error ? err.message : "request failed" });
    }
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 40,
        padding: 24,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <DispersionMark size={44} />
        <span style={{ fontSize: 30, fontWeight: 500, letterSpacing: "-0.01em" }}>GAI Caddie</span>
      </div>

      <p
        className="serif"
        style={{ margin: 0, fontSize: 22, color: "var(--muted)", textAlign: "center", maxWidth: 440 }}
      >
        The strokes-gained engine, in your pocket.
      </p>

      {/* Primary entry point into the yardage book */}
      <Link
        href="/courses"
        style={{
          background: "var(--green)",
          color: "var(--bg)",
          border: "none",
          borderRadius: 10,
          padding: "13px 22px",
          fontSize: 15,
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        Open the yardage book →
      </Link>

      {/* Phase 0 round-trip: client → Vercel function → Postgres → back */}
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div
          className="mono"
          style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--faint)" }}
        >
          Phase 0 · skeleton &amp; rails
        </div>

        <button
          onClick={ping}
          disabled={health.status === "loading"}
          style={{
            appearance: "none",
            cursor: health.status === "loading" ? "default" : "pointer",
            background: "var(--raise)",
            color: "var(--text)",
            border: "1px solid var(--line2)",
            borderRadius: 10,
            padding: "12px 16px",
            fontSize: 15,
            fontFamily: "inherit",
            transition: "border-color 120ms ease",
          }}
        >
          {health.status === "loading" ? "Pinging backend…" : "Ping the backend"}
        </button>

        <div className="mono" style={{ fontSize: 13, lineHeight: 1.7, minHeight: 72 }}>
          {health.status === "idle" && (
            <span style={{ color: "var(--faint)" }}>
              Click to round-trip a write+read through Postgres.
            </span>
          )}
          {health.status === "loading" && <span style={{ color: "var(--muted)" }}>…</span>}
          {health.status === "ok" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ color: "var(--green)" }}>● round-trip ok</span>
              <span style={{ color: "var(--muted)" }}>message: {health.message}</span>
              <span style={{ color: "var(--muted)" }}>db_time: {health.dbTime}</span>
              <span style={{ color: "var(--muted)" }}>sg-engine: v{health.sgEngineVersion}</span>
            </div>
          )}
          {health.status === "error" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ color: "var(--red)" }}>● round-trip failed</span>
              <span style={{ color: "var(--muted)" }}>{health.error}</span>
            </div>
          )}
        </div>
      </div>

      {/* Confidence legend — invariant #2 made visible from day one */}
      <div style={{ display: "flex", gap: 18 }}>
        {FLAGS.map(({ flag, label }) => (
          <div key={flag} className="mono" style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: CONFIDENCE_COLOR[flag],
                display: "inline-block",
              }}
            />
            <span style={{ color: "var(--muted)" }}>{label}</span>
          </div>
        ))}
      </div>

      <footer style={{ fontSize: 12, color: "var(--faint)" }}>Built by Back Tee Partners</footer>
    </main>
  );
}
