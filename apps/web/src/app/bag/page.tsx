import { getBagClubs, runMigrations } from "@gai/api";
import {
  type BagClubView,
  clubDisplayName,
  carryConfidenceLine,
  dispersionBand,
  isDispersionEstimated,
  latestSession,
} from "./bagView";

// DB-backed, server-only (mirrors /play). pg needs the Node runtime; the data is
// live, so never statically cache. INVARIANT #3: this reads @gai/api on the
// server — the DATABASE_URL / Anthropic key never reach the client bundle.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Mission 3a — Bag tab, ALL CLUBS list (display only) ─────────────────────────
//
// Header + the ALL CLUBS list + footer caption. Out of scope (Mission 3b): the
// carry & dispersion map, the insight cards, and the per-row warning triangles.
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

function ConfidenceDot({ color }: { color: string }) {
  return <span className="bag-dot" style={{ background: color }} aria-hidden />;
}

function ClubRow({ c }: { c: BagClubView }) {
  const band = dispersionBand(c.lateralSdYards);
  const estimated = isDispersionEstimated(c);
  return (
    <li className="bag-row">
      <div className="bag-row-id">
        <span className="bag-club">{clubDisplayName(c.club)}</span>
        <span className="bag-carry-conf">{carryConfidenceLine(c)}</span>
      </div>

      <div className="bag-carry">
        <span className="bag-carry-num">{c.carryYards}</span>
        <span className="bag-carry-unit">yd</span>
      </div>

      <div className={estimated ? "bag-disp is-est" : "bag-disp"}>
        <div className="bag-disp-head">
          <ConfidenceDot color={band.color} />
          <span className="bag-disp-word" style={{ color: band.color }}>
            {band.word}
          </span>
          <span className="bag-disp-val">
            ±{c.lateralSdYards} yd{estimated ? " est." : ""}
          </span>
        </div>
        <div className="bag-bar">
          <span
            className="bag-bar-fill"
            style={{ width: `${Math.round(band.fill * 100)}%`, background: band.color }}
          />
        </div>
      </div>
    </li>
  );
}

export default async function BagPage() {
  await runMigrations();
  const clubsRaw = await getBagClubs();
  const clubs: BagClubView[] = clubsRaw; // BagClub is structurally BagClubView

  const lastSession = latestSession(clubs);

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
