import Link from "next/link";
import { notFound } from "next/navigation";
import { getRound, summarizeRound, computeScoringWeaknesses } from "@gai/api";
import RecapCoach from "./RecapCoach";

// DB-backed, server-only. pg needs the Node runtime; never statically cache. Every
// number rendered here is computed server-side (invariant #1) — the page is the
// post-round Recap, integrated into the play flow (not a separate tab).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Score-cell coloring (invariant #2 semantics, scoring edition) ───────────────
function scoreClass(strokes: number, par: number | null): string {
  if (par == null) return "rc-sc-par";
  if (strokes < par) return "rc-sc-birdie"; // birdie or better → green
  if (strokes === par) return "rc-sc-par"; // par → text
  if (strokes === par + 1) return "rc-sc-bogey"; // bogey → amber
  return "rc-sc-double"; // double or worse → red
}

function vsParLabel(vsPar: number): string {
  if (vsPar === 0) return "E";
  return vsPar > 0 ? `+${vsPar}` : `${vsPar}`;
}
function vsParClass(vsPar: number): string {
  if (vsPar < 0) return "rc-green";
  if (vsPar === 0) return "rc-text";
  return "rc-amber";
}

// Weakness area → human label + a one-line description + the practice focus area to
// pre-populate. `focus` is the query param the /practice page reads on load.
const WEAKNESS_META: Record<string, { label: string; desc: string }> = {
  three_putt_pct: { label: "Three-putts", desc: "Too many holes ending in three or more putts — a lag-speed leak." },
  doubles_per_round: { label: "Doubles", desc: "Big numbers are bleeding strokes — the chain usually starts off the tee." },
  scrambling_pct: { label: "Scrambling", desc: "Missing greens and not getting up-and-down often enough." },
  fairway_pct: { label: "Fairways", desc: "Accuracy off the tee is below the line, leaving longer approaches." },
};

// ── Stat tiles ──────────────────────────────────────────────────────────────────
// Each tile compares the round value against a benchmark; higherIsBetter flips the
// coloring (putts/round is lower-is-better). green at/above, amber within 20%, red
// more than 20% below (mirrored for lower-is-better metrics).
function tileClass(value: number | null, benchmark: number, higherIsBetter: boolean): string {
  if (value == null) return "rc-faint";
  const ratio = value / benchmark;
  if (higherIsBetter) {
    if (ratio >= 1) return "rc-green";
    if (ratio >= 0.8) return "rc-amber";
    return "rc-red";
  }
  // lower is better: at/below benchmark is good
  if (ratio <= 1) return "rc-green";
  if (ratio <= 1.2) return "rc-amber";
  return "rc-red";
}

export default async function RecapPage({
  params,
}: {
  params: Promise<{ courseId: string; roundId: string }>;
}) {
  const { courseId, roundId } = await params;

  const round = await getRound(roundId);
  if (!round || round.courseId !== courseId) notFound();

  const stats = summarizeRound(round);
  const weaknesses = await computeScoringWeaknesses();

  const holes = round.holes;
  const front = holes.filter((h) => h.holeNumber <= 9);
  const back = holes.filter((h) => h.holeNumber > 9);
  const sum = (hs: typeof holes, f: (h: (typeof holes)[number]) => number) =>
    hs.reduce((s, h) => s + f(h), 0);

  const fairwayPct = stats.fairwayPct;
  const girPct = stats.girPct;
  const scramblingPct = stats.scramblingPct;
  const puttsPerRound = stats.puttsPerRound;

  return (
    <main className="rc-page">
      {/* A — round summary header */}
      <header className="rc-head">
        <Link href={`/play/${courseId}`} className="mono rc-back">
          ← {round.courseName}
        </Link>
        <div className="rc-head-row">
          <h1 className="rc-title">Round recap</h1>
          <span className={`rc-vspar mono ${vsParClass(stats.vsPar)}`}>{vsParLabel(stats.vsPar)}</span>
        </div>
        <div className="mono rc-sub">
          {formatDate(round.playedDate)} · {stats.totalStrokes} strokes
          {stats.totalPutts != null && <> · {stats.totalPutts} putts</>}
          {" · "}
          {stats.holesPlayed} holes
        </div>
      </header>

      {/* B — scorecard */}
      <section className="rc-card">
        <table className="rc-table">
          <thead>
            <tr>
              <th className="rc-th-l">Hole</th>
              <th>Par</th>
              <th>Yds</th>
              <th>Score</th>
              <th>vs</th>
              <th>Putts</th>
            </tr>
          </thead>
          <tbody>
            {round.holes.map((h) => {
              const vs = h.par != null ? h.strokes - h.par : null;
              return (
                <tr key={h.holeNumber}>
                  <td className="rc-th-l mono">{h.holeNumber}</td>
                  <td className="mono">{h.par ?? "—"}</td>
                  <td className="mono rc-faint">{h.yardageWhite ?? "—"}</td>
                  <td className={`mono rc-score ${scoreClass(h.strokes, h.par)}`}>{h.strokes}</td>
                  <td className="mono rc-faint">{vs == null ? "—" : vs === 0 ? "E" : vs > 0 ? `+${vs}` : vs}</td>
                  <td className="mono rc-faint">{h.putts ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {front.length > 0 && (
              <tr className="rc-subtotal">
                <td className="rc-th-l">Out</td>
                <td className="mono">{sum(front, (h) => h.par ?? 0)}</td>
                <td className="mono">{sum(front, (h) => h.yardageWhite ?? 0) || "—"}</td>
                <td className="mono">{sum(front, (h) => h.strokes)}</td>
                <td colSpan={2} className="mono" />
              </tr>
            )}
            {back.length > 0 && (
              <tr className="rc-subtotal">
                <td className="rc-th-l">In</td>
                <td className="mono">{sum(back, (h) => h.par ?? 0)}</td>
                <td className="mono">{sum(back, (h) => h.yardageWhite ?? 0) || "—"}</td>
                <td className="mono">{sum(back, (h) => h.strokes)}</td>
                <td colSpan={2} className="mono" />
              </tr>
            )}
            <tr className="rc-total">
              <td className="rc-th-l">Total</td>
              <td className="mono">{stats.totalPar}</td>
              <td className="mono" />
              <td className="mono">{stats.totalStrokes}</td>
              <td className={`mono ${vsParClass(stats.vsPar)}`}>{vsParLabel(stats.vsPar)}</td>
              <td className="mono">{stats.totalPutts ?? "—"}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      {/* C — round stats */}
      <section className="rc-tiles">
        <div className="rc-tile">
          <div className="rc-tile-label mono">Fairways hit</div>
          <div className={`rc-tile-val mono ${tileClass(fairwayPct, 50, true)}`}>
            {stats.fairwaysPossible > 0 ? `${stats.fairwaysHit}/${stats.fairwaysPossible}` : "—"}
          </div>
          <div className="rc-tile-bench mono">Hdcp benchmark: 50%</div>
        </div>
        <div className="rc-tile">
          <div className="rc-tile-label mono">GIR</div>
          <div className={`rc-tile-val mono ${tileClass(girPct, 33, true)}`}>
            {stats.gir}/{stats.holesPlayed}
          </div>
          <div className="rc-tile-bench mono">Hdcp benchmark: 33%</div>
        </div>
        <div className="rc-tile">
          <div className="rc-tile-label mono">Scrambling</div>
          <div className={`rc-tile-val mono ${tileClass(scramblingPct, 40, true)}`}>
            {scramblingPct != null ? `${scramblingPct}%` : "—"}
          </div>
          <div className="rc-tile-bench mono">Tour avg: 60% · hdcp: 40%</div>
        </div>
        <div className="rc-tile">
          <div className="rc-tile-label mono">Putts / round</div>
          <div className={`rc-tile-val mono ${tileClass(puttsPerRound, 32, false)}`}>
            {puttsPerRound ?? "—"}
          </div>
          <div className="rc-tile-bench mono">Hdcp benchmark: 32</div>
        </div>
      </section>

      {/* D — weakness signals → feed the practice ranker */}
      {weaknesses.length > 0 && (
        <section className="rc-weak">
          <div className="rc-label mono">Weakness signals</div>
          {weaknesses.map((w) => {
            const meta = WEAKNESS_META[w.area] ?? { label: w.area, desc: "Outside the benchmark." };
            return (
              <div className="rc-weak-card" key={w.area}>
                <div className="rc-weak-top">
                  <span className="rc-weak-name">{meta.label}</span>
                  <span className="rc-weak-fig mono">
                    <b className="rc-amber">{w.value}</b>
                    <span className="rc-faint"> vs {w.benchmark}</span>
                  </span>
                </div>
                <p className="rc-weak-desc">{meta.desc}</p>
                <Link href={`/practice?focus=${encodeURIComponent(w.area)}`} className="rc-weak-cta mono">
                  Take to Practice →
                </Link>
              </div>
            );
          })}
        </section>
      )}

      {/* E — caddie recap (optional, load on demand) */}
      <RecapCoach roundId={roundId} />

      {/* F — navigation */}
      <nav className="rc-nav">
        <Link href={`/play/${courseId}`} className="rc-nav-btn mono">
          Play again →
        </Link>
        <Link href="/practice" className="rc-nav-btn rc-nav-ghost mono">
          Log a practice session →
        </Link>
      </nav>

      <footer className="rc-footer">Built by Back Tee Partners</footer>
    </main>
  );
}

// "2026-06-05" → "Jun 5, 2026" (parsed as plain parts; no Date tz shift).
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mi = Number(m) - 1;
  return `${months[mi] ?? ""} ${Number(d)}, ${y}`;
}
