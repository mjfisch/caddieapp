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
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Capt. 69 OS">
      <g transform="rotate(-22 32 32)">
        <ellipse cx="32" cy="32" rx="20" ry="11.5" fill="none" stroke="var(--green)" strokeWidth="3.2" />
        <ellipse cx="32" cy="32" rx="11.5" ry="6.6" fill="none" stroke="var(--green)" strokeWidth="3.2" />
      </g>
      <circle cx="32" cy="32" r="3.2" fill="var(--green)" />
      <circle cx="42" cy="27.6" r="2.4" fill="var(--green)" />
    </svg>
  );
}

const ARROW = (
  <svg className="lp-card-arr" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

// Entry icons — stroke glyphs (currentColor), matching the bottom-nav set.
function EntryIcon({ kind }: { kind: "book" | "flag" | "target" }) {
  const c = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (kind === "book")
    return (
      <svg {...c}>
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5Z" />
        <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5Z" />
      </svg>
    );
  if (kind === "flag")
    return (
      <svg {...c}>
        <path d="M6 21V3" />
        <path d="M6 4h11l-3 3.5L17 11H6" />
      </svg>
    );
  return (
    <svg {...c}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

const ENTRIES: {
  href: string;
  title: string;
  sub: string;
  icon: "book" | "flag" | "target";
  primary?: boolean;
}[] = [
  { href: "/courses", title: "Open the yardage book", sub: "Prep & strategy, hole by hole", icon: "book", primary: true },
  { href: "/play", title: "Play a round", sub: "On-course, glance-and-go", icon: "flag" },
  { href: "/practice", title: "Practice", sub: "Log sessions, get a coach plan", icon: "target" },
];

export default function Home() {
  return (
    <main className="lp-page">
      {/* Top app-bar — brand left, handicap right. */}
      <header className="lp-topbar">
        <div className="lp-brand">
          <span className="lp-logo">
            <DispersionMark size={22} />
          </span>
          <span className="lp-brand-text">
            <strong>
              CAPT. 69 <span style={{ color: "var(--green)" }}>OS</span>
            </strong>
            <small>by Back Tee Partners</small>
          </span>
        </div>
        <span className="lp-hcp mono">
          <em>HCP</em> 2.1
        </span>
      </header>

      {/* Hero — mono eyebrow + serif display line (existing copy). */}
      <section className="lp-hero">
        <span className="lp-eyebrow">Strokes-gained caddie</span>
        <h1 className="lp-title serif">Built for the next 69.</h1>
      </section>

      {/* Entry points: primary = prep/yardage book, then on-course play, then practice. */}
      <nav className="lp-entries" aria-label="Get started">
        {ENTRIES.map((e) => (
          <Link key={e.href} href={e.href} className={e.primary ? "lp-card primary" : "lp-card"}>
            <span className="lp-card-ic">
              <EntryIcon kind={e.icon} />
            </span>
            <span className="lp-card-tx">
              <b>{e.title}</b>
              <small>{e.sub}</small>
            </span>
            {ARROW}
          </Link>
        ))}
      </nav>

      {/* Confidence legend — invariant #2 made visible from day one. */}
      <div className="lp-legend">
        {FLAGS.map(({ flag, label }) => (
          <div key={flag} className="lp-legend-item">
            <span className="lp-legend-dot" style={{ background: CONFIDENCE_COLOR[flag] }} />
            <span>{label}</span>
          </div>
        ))}
      </div>

      <footer className="lp-footer">Built by Back Tee Partners</footer>
    </main>
  );
}
