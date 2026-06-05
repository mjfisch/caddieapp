import Link from "next/link";
import { CONFIDENCE_COLOR, type ConfidenceFlag } from "@gai/shared";

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

      {/* Entry points: primary = prep/yardage book, secondary = on-course play */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
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
        <Link
          href="/play"
          style={{
            background: "transparent",
            color: "var(--green)",
            border: "1px solid var(--green)",
            borderRadius: 10,
            padding: "13px 22px",
            fontSize: 15,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Play a round →
        </Link>
        <Link
          href="/practice"
          style={{
            background: "transparent",
            color: "var(--muted)",
            border: "1px solid var(--line2)",
            borderRadius: 10,
            padding: "13px 22px",
            fontSize: 15,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Practice →
        </Link>
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
