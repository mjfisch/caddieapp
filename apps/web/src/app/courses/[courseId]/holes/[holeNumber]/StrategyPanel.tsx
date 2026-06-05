"use client";

import { useState } from "react";

// The caddie strategy panel (Phase 3B). Renders the persona selector + conditions
// form, POSTs to /api/strategy, and streams the SSE response: engine numbers first
// (rendered above), then the caddie prose streamed in below.
//
// This file is CLIENT code. It must never import @gai/api or reference the
// Anthropic key — the key lives only in the server route (invariant #3). It talks
// to the server exclusively over fetch.

type EngineView = {
  club: string;
  carryTarget: number;
  dangerSide: "left" | "right" | "center" | null;
  layupRecommended: boolean;
  confidenceFlag: "measured" | "partial" | "seeded";
};

// Locked personas (invariant #6). Ids match @gai/sg-engine PERSONAS keys.
const PERSONAS: { id: string; label: string }[] = [
  { id: "beta", label: "Beta" },
  { id: "rain_man", label: "Rain Man" },
  { id: "captain_69", label: "Captain 69" },
  { id: "the_ringer", label: "The Ringer" },
];

const WIND_DIRS = ["N", "S", "E", "W", "Into", "Down", "Cross"] as const;
const PINS = ["front", "middle", "back"] as const;

// Confidence flag → semantic token (invariant #2).
const CONFIDENCE_COLOR: Record<EngineView["confidenceFlag"], string> = {
  measured: "var(--green)",
  partial: "var(--amber)",
  seeded: "var(--faint)",
};

// Swing mechanics must never appear in caddie output (Layer 1). If they do, the UI
// flags it rather than hiding it.
const SWING_TERMS = /\b(swing|backswing|follow-through|takeaway)\b/i;

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono), monospace",
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--faint)",
};

interface SseEvent {
  event: string;
  data: unknown;
}

/** Parse one raw SSE frame (`event: x\ndata: {...}`) into {event, data}. */
function parseFrame(raw: string): SseEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

export default function StrategyPanel({
  courseId,
  holeNumber,
}: {
  courseId: string;
  holeNumber: number;
}) {
  const [persona, setPersona] = useState("rain_man"); // default per the brief
  const [windMph, setWindMph] = useState("");
  const [windDir, setWindDir] = useState<string>("Into");
  const [pinPosition, setPinPosition] = useState<(typeof PINS)[number]>("middle");
  const [notes, setNotes] = useState("");

  const [loading, setLoading] = useState(false);
  const [engine, setEngine] = useState<EngineView | null>(null);
  const [caddieText, setCaddieText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const overstepped = SWING_TERMS.test(caddieText);

  async function getRead() {
    setLoading(true);
    setError(null);
    setEngine(null);
    setCaddieText("");

    const conditions: Record<string, unknown> = { pinPosition };
    if (windMph.trim() !== "" && !Number.isNaN(Number(windMph))) {
      conditions.windMph = Number(windMph);
    }
    if (windDir) conditions.windDir = windDir;
    if (notes.trim() !== "") conditions.notes = notes.trim();

    try {
      const res = await fetch("/api/strategy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId, holeNumber, persona, conditions }),
      });

      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(j?.error ?? "Could not get a read.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const frame = parseFrame(buf.slice(0, sep));
          buf = buf.slice(sep + 2);
          if (!frame) continue;
          if (frame.event === "engine") {
            setEngine(frame.data as EngineView);
          } else if (frame.event === "delta") {
            acc += (frame.data as { text: string }).text;
            setCaddieText(acc);
          } else if (frame.event === "error") {
            setError((frame.data as { error: string }).error);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }

  const dangerChip = (() => {
    if (!engine) return null;
    const danger = engine.dangerSide; // red if a side is flagged, grey if none
    const isDanger = danger != null;
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          borderRadius: 999,
          padding: "4px 12px",
          fontSize: 13,
          fontFamily: "var(--font-mono), monospace",
          color: isDanger ? "var(--red)" : "var(--faint)",
          background: isDanger ? "rgba(240,114,111,0.12)" : "var(--panel)",
          border: `1px solid ${isDanger ? "rgba(240,114,111,0.4)" : "var(--line2)"}`,
        }}
      >
        {isDanger ? `⚠ danger ${danger}` : "no danger side"}
      </span>
    );
  })();

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
        background: "var(--bg2)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        padding: "20px 20px 24px",
      }}
    >
      <div style={labelStyle}>Caddie read</div>

      {/* Persona selector */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={labelStyle}>Persona</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {PERSONAS.map((p) => {
            const active = p.id === persona;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPersona(p.id)}
                style={{
                  cursor: "pointer",
                  borderRadius: 999,
                  padding: "8px 14px",
                  fontSize: 13,
                  fontFamily: "var(--font-mono), monospace",
                  color: active ? "var(--bg)" : "var(--text)",
                  background: active ? "var(--green)" : "var(--panel)",
                  border: `1px solid ${active ? "var(--green)" : "var(--line2)"}`,
                  fontWeight: active ? 600 : 400,
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Conditions form */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 12,
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={labelStyle}>Wind (mph)</span>
          <input
            type="number"
            inputMode="numeric"
            value={windMph}
            onChange={(e) => setWindMph(e.target.value)}
            placeholder="0"
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={labelStyle}>Direction</span>
          <select value={windDir} onChange={(e) => setWindDir(e.target.value)} style={inputStyle}>
            {WIND_DIRS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={labelStyle}>Pin</span>
          <select
            value={pinPosition}
            onChange={(e) => setPinPosition(e.target.value as (typeof PINS)[number])}
            style={inputStyle}
          >
            {PINS.map((p) => (
              <option key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1 / -1" }}>
          <span style={labelStyle}>Notes (optional)</span>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="firm greens, tucked pin…"
            style={inputStyle}
          />
        </label>
      </div>

      <button
        type="button"
        onClick={getRead}
        disabled={loading}
        style={{
          alignSelf: "flex-start",
          cursor: loading ? "default" : "pointer",
          borderRadius: 10,
          padding: "10px 18px",
          fontSize: 14,
          fontWeight: 600,
          color: "var(--bg)",
          background: loading ? "var(--muted)" : "var(--green)",
          border: "none",
        }}
      >
        {loading ? "Reading the hole…" : "Get caddie read"}
      </button>

      {error && (
        <p style={{ margin: 0, color: "var(--red)", fontSize: 14 }}>{error}</p>
      )}

      {/* Engine output block — the numbers, above the prose (invariant #1). */}
      {engine && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-end",
            gap: 24,
            paddingTop: 6,
            borderTop: "1px solid var(--line)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>Club</span>
            <span
              style={{
                fontSize: 38,
                fontWeight: 600,
                lineHeight: 1,
                color: "var(--green)",
                fontFamily: "var(--font-mono), monospace",
              }}
            >
              {engine.club}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>Carry{engine.layupRecommended ? " (layup)" : ""}</span>
            <span
              style={{
                fontSize: 38,
                fontWeight: 600,
                lineHeight: 1,
                color: "var(--text)",
                fontFamily: "var(--font-mono), monospace",
              }}
            >
              {engine.carryTarget}
              <span style={{ fontSize: 15, color: "var(--muted)" }}> yds</span>
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={labelStyle}>Read</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {dangerChip}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  borderRadius: 999,
                  padding: "4px 12px",
                  fontSize: 13,
                  fontFamily: "var(--font-mono), monospace",
                  color: CONFIDENCE_COLOR[engine.confidenceFlag],
                  background: "var(--panel)",
                  border: "1px solid var(--line2)",
                }}
              >
                {engine.confidenceFlag}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Swing-mechanics guard — Layer 1 overstep. */}
      {overstepped && (
        <div
          style={{
            display: "inline-flex",
            alignSelf: "flex-start",
            alignItems: "center",
            gap: 6,
            borderRadius: 8,
            padding: "6px 12px",
            fontSize: 13,
            fontWeight: 600,
            color: "#1a1400",
            background: "var(--amber)",
          }}
        >
          ⚠ caddie overstepped — review Layer 1
        </div>
      )}

      {/* Caddie voice — streams in below the numbers. */}
      {(caddieText || loading) && (
        <div
          aria-live="polite"
          aria-busy={loading}
          style={{
            minHeight: 64,
            whiteSpace: "pre-wrap",
            fontSize: 16,
            lineHeight: 1.6,
            color: caddieText ? "var(--text)" : "var(--muted)",
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 12,
            padding: "14px 16px",
          }}
        >
          {caddieText || "Reading the hole…"}
        </div>
      )}
    </section>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line2)",
  borderRadius: 8,
  padding: "9px 11px",
  fontSize: 14,
  color: "var(--text)",
  fontFamily: "var(--font-mono), monospace",
  width: "100%",
};
