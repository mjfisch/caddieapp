import { getBagClubs, getClubShotCounts, runMigrations } from "@gai/api";
import {
  type BagClubView,
  buildCarryMap,
  latestSession,
  shotDataProgress,
  SHOT_TARGET,
} from "./bagView";
import { ClubRow } from "./ClubRow";

// DB-backed, server-only (mirrors /play). pg needs the Node runtime; the data is
// live, so never statically cache. INVARIANT #3: this reads @gai/api on the
// server — the DATABASE_URL / Anthropic key never reach the client bundle.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Bag tab (display only) ──────────────────────────────────────────────────────
//
// Mission 3a: header + the ALL CLUBS list + footer caption.
// Mission 3b: two data-quality insight cards + the carry & consistency RATING map,
//   inserted above the list (order: cards → map → list). No LLM, no SG compute.
//
// DATA-MODEL GAP (reported, deliberately not fabricated around):
//   1. The canonical `club_dispersion` table has NO ordinal 1–N rating — only a
//      real measured lateral SD in yards. So the rating shows the actual ±yd and
//      a Tight/Steady/Loose band, NOT a synthetic /10 score.
//   2. There is ONE `confidence` flag per row; no SEPARATE dispersion-confidence
//      field. We fall back conservatively (isDispersionEstimated): a rating not
//      backed by a measured 5+ shot sample renders muted / "est.". Today every
//      bag club clears that bar, so nothing mutes — but the path is honest if a
//      future club is seeded. Worth deciding whether to add the field.
//   3. The driver reads `measured` (n=10) off a STALE 2022 sample; per the chosen
//      call we trust the flag and let its visible last-session date tell the truth.

// ── Mission 3b — data-quality insight cards (both amber: action/goal) ───────────

function InsightCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="bag-card bag-card-amber">
      <span className="bag-card-ic" aria-hidden>
        {icon}
      </span>
      <div className="bag-card-tx">
        <b>{title}</b>
        <p>{body}</p>
      </div>
    </div>
  );
}

// ── Mission 3b — carry & consistency RATING map (SVG, server-rendered) ──────────
// Reads the pure geometry from buildCarryMap. Color + size encode the consistency
// band; X is carry. NOT a true shot-dispersion pattern (see bagView header note).

function CarryMap({ clubs }: { clubs: BagClubView[] }) {
  const m = buildCarryMap(clubs);
  return (
    <div className="bag-map-wrap">
      <svg
        className="bag-map"
        viewBox={`0 0 ${m.width} ${m.height}`}
        role="img"
        aria-label="Carry and consistency rating map: each club plotted by carry distance, with ellipse size and color showing its Tight, Steady, or Loose consistency band."
      >
        {m.gridLines.map((g) => (
          <g key={g.carry}>
            <line
              className="bag-map-grid"
              x1={g.x}
              y1={m.gridTop}
              x2={g.x}
              y2={m.gridBottom}
            />
            <text className="bag-map-axis" x={g.x} y={11} textAnchor="middle">
              {g.carry}
            </text>
          </g>
        ))}

        {m.points.map((p) => (
          <g key={p.club} opacity={p.opacity}>
            <ellipse
              cx={p.cx}
              cy={p.cy}
              rx={p.rx}
              ry={p.ry}
              fill={p.color}
              fillOpacity={0.22}
              stroke={p.color}
              strokeWidth={1.4}
            />
            <circle cx={p.cx} cy={p.cy} r={1.5} fill={p.color} />
            <text
              className="bag-map-lbl"
              x={p.cx}
              y={p.cy - p.ry - 3}
              textAnchor="middle"
            >
              {p.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export default async function BagPage() {
  await runMigrations();
  const [clubsRaw, shotCounts] = await Promise.all([getBagClubs(), getClubShotCounts()]);
  const clubs: BagClubView[] = clubsRaw; // BagClub is structurally BagClubView

  const lastSession = latestSession(clubs);

  // Card 1 (COMPUTED): a plain query + threshold check in code — never the model.
  const progress = shotDataProgress(clubs, shotCounts);
  const card1Body = progress.allReached
    ? `All clubs have reached the ${SHOT_TARGET}-shot target — dispersion data is fully optimized.`
    : `${progress.reached} of ${progress.total} clubs have reached ${SHOT_TARGET}+ measured shots. ` +
      `Clubs still needing data: ${progress.below.join(", ")}.`;

  return (
    <main className="bag-page">
      <header className="bag-header">
        <span className="lp-eyebrow">Bag profile</span>
        <h1 className="bag-title serif">Your bag</h1>
        <p className="bag-sub">
          {clubs.length} clubs · Trackman
          {lastSession ? <> · last session {lastSession}</> : null}
        </p>
      </header>

      <section className="bag-cards">
        <InsightCard icon={<DataIcon />} title="Build out your shot data" body={card1Body} />
        {/* Card 2 (STATIC): off-the-tee priority. Always shown until a future
            off-the-tee context tag on the shot log lets us detect dedicated tee
            shots per club (FUTURE ENHANCEMENT) — today no such tag exists, so the
            3-hybrid / 4-iron tee numbers are inferred from fairway data. */}
        <InsightCard
          icon={<TeeIcon />}
          title="Off-the-tee data needed"
          body={
            "Collect dedicated off-the-tee Trackman shots for the 3-hybrid and 4-iron. " +
            "Current tee-shot carry and dispersion for these clubs is estimated from fairway data."
          }
        />
      </section>

      <section className="bag-map-section">
        <h2 className="bag-section-label">
          <ChartIcon /> Carry &amp; consistency rating map
        </h2>
        <CarryMap clubs={clubs} />
        <p className="bag-caption">
          A consistency rating, not a true shot pattern · ellipse size &amp; color show the
          Tight / Steady / Loose band · x-axis is carry (yd)
        </p>
      </section>

      <section className="bag-all">
        <h2 className="bag-section-label">
          <BagIcon /> All clubs
        </h2>
        <ul className="bag-list">
          {clubs.map((c) => (
            <ClubRow key={c.club} c={c} />
          ))}
        </ul>
        <p className="bag-caption">
          Dispersion is the measured 1-SD lateral spread in yards · lower is tighter
        </p>
      </section>
    </main>
  );
}

function BagIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <rect x="4" y="7" width="14" height="14" rx="2" />
      <path d="M18 11h2a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-2" />
    </svg>
  );
}

// Card 1 — "build out data": rising bars.
function DataIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 20V10M12 20V4M18 20v-6" />
    </svg>
  );
}

// Card 2 — "off-the-tee": a golf flag.
function TeeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 21V4" />
      <path d="M6 4l11 3.5L6 11" fill="currentColor" fillOpacity="0.18" />
      <path d="M4 21h6" />
    </svg>
  );
}

// Map section label — a small line chart.
function ChartIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 3 3 5-6" />
    </svg>
  );
}
