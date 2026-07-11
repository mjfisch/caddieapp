import Link from "next/link";

// Stats tab — minimal stub (Mission S2, D20/D25). The real surface (3 filters ×
// 7 derived stat groups over the round table) ships in a later mission once the
// schema migration and round sync land. No fake data, no placeholder charts —
// just the house-style eyebrow/heading pattern and a one-line "coming soon".
export default function StatsPage() {
  return (
    <main
      style={{
        maxWidth: 480,
        margin: "0 auto",
        minHeight: "calc(100dvh - 56px - env(safe-area-inset-bottom))",
        padding: "32px 24px 64px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <Link href="/" className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
        ← home
      </Link>

      <span
        className="mono"
        style={{
          marginTop: 8,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: "var(--green)",
        }}
      >
        Stats
      </span>

      <h1
        className="serif"
        style={{ margin: 0, fontSize: 40, lineHeight: 1.05, fontWeight: 400, color: "var(--text)" }}
      >
        The scorecard, read back.
      </h1>

      <p style={{ margin: "4px 0 0", fontSize: 15, lineHeight: 1.5, color: "var(--muted)" }}>
        Round history and scoring trends arrive in an upcoming release.
      </p>
    </main>
  );
}
