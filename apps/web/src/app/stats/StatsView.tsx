"use client";

import { useMemo, useState } from "react";
import {
  computeStats,
  formatSignedDelta,
  selectWindow,
  STATS_WINDOWS,
  STATS_WINDOW_LABELS,
  type StatsRound,
  type StatsWindow,
} from "./computeStats";
import { RoundList } from "./RoundList";

// =============================================================
// Mission S6 — the Stats tab surface: three filter pills over the seven §4
// stat groups, per the approved mockup. The server page loads ALL non-test
// rounds once; a filter switch recomputes client-side through the same pure
// computeStats module the tests pin — no second derivation path (D25).
//
// Mission S10 hangs the round-by-round listing off the SAME windowed array the
// cards are derived from — one filter control, one dataset, one ordering
// (Hcp 8 arrives differential-ascending straight from selectWindow).
// =============================================================

export function StatsView({
  rounds,
  currentYear,
}: {
  rounds: StatsRound[];
  currentYear: number;
}) {
  const [window, setWindow] = useState<StatsWindow>("last20");
  const windowed = useMemo(
    () => selectWindow(rounds, window, currentYear),
    [rounds, window, currentYear],
  );
  const stats = useMemo(() => computeStats(windowed), [windowed]);

  return (
    <>
      <div className="st-pills" role="tablist" aria-label="Stats window">
        {STATS_WINDOWS.map((w) => (
          <button
            key={w}
            role="tab"
            aria-selected={window === w}
            className={`st-pill mono${window === w ? " on" : ""}`}
            onClick={() => setWindow(w)}
          >
            {STATS_WINDOW_LABELS[w]}
          </button>
        ))}
      </div>

      {stats === null ? (
        <div className="st-empty">
          <p className="st-empty-line mono">No rounds in this window yet.</p>
          <p className="st-empty-sub">
            {window === "ytd"
              ? `Nothing posted in ${currentYear} so far — the record starts with the first round.`
              : "Rounds land here through the round-logger loop."}
          </p>
        </div>
      ) : (
        <>
          {/* ── Hero strip: avg score · avg diff · GIR% ─────────────────── */}
          <section className="st-hero" aria-label="Scoring averages">
            <div className="st-hero-cell">
              <span className="st-hero-num mono">{stats.avgScore.toFixed(1)}</span>
              <span className="st-hero-lbl mono">Avg score</span>
            </div>
            <div className="st-hero-cell">
              <span className="st-hero-num mono">{stats.avgDifferential.toFixed(1)}</span>
              <span className="st-hero-lbl mono">Avg diff</span>
            </div>
            <div className="st-hero-cell">
              <span className="st-hero-num mono">
                {stats.girPct.toFixed(1)}
                <em>%</em>
              </span>
              <span className="st-hero-lbl mono">GIR</span>
            </div>
          </section>

          {/* ── Fairways: three-way split bar ───────────────────────────── */}
          <section aria-label="Fairways">
            <h2 className="st-label mono">Fairways · L / hit / R</h2>
            {stats.fairways ? (
              <>
                <div className="st-bar" aria-hidden>
                  <span
                    className="st-seg st-seg-left"
                    style={{ width: `${stats.fairways.missLeftPct}%` }}
                  />
                  <span
                    className="st-seg st-seg-hit"
                    style={{ width: `${stats.fairways.hitPct}%` }}
                  />
                  <span
                    className="st-seg st-seg-right"
                    style={{ width: `${stats.fairways.missRightPct}%` }}
                  />
                </div>
                <div className="st-bar-legend mono">
                  <span className="st-lg-left">left {stats.fairways.missLeftPct.toFixed(1)}%</span>
                  <span className="st-lg-hit">hit {stats.fairways.hitPct.toFixed(1)}%</span>
                  <span className="st-lg-right">right {stats.fairways.missRightPct.toFixed(1)}%</span>
                </div>
              </>
            ) : (
              <p className="st-none">No fairway data in this window.</p>
            )}
          </section>

          {/* ── Putting: 1 / 2 / 3+ putt split bar ──────────────────────── */}
          <section aria-label="Putting">
            {stats.putting ? (
              <>
                <h2 className="st-label mono">
                  Putting · {stats.putting.avgPutts.toFixed(1)} / rd
                </h2>
                <PuttingBar putting={stats.putting} />
                <div className="st-bar-legend mono">
                  <span className="st-lg-hit">1-putt {stats.putting.onePutt.toFixed(1)}</span>
                  <span className="st-lg-mid">2-putt {stats.putting.twoPutt.toFixed(1)}</span>
                  <span className="st-lg-left">3+ {stats.putting.threePlus.toFixed(1)}</span>
                </div>
              </>
            ) : (
              <>
                <h2 className="st-label mono">Putting</h2>
                <p className="st-none">No putting data in this window.</p>
              </>
            )}
          </section>

          {/* ── Scoring vs par: three delta cards ───────────────────────── */}
          <section aria-label="Scoring vs par">
            <h2 className="st-label mono">Scoring vs par</h2>
            <div className="st-cards">
              {([3, 4, 5] as const).map((par) => {
                const delta = stats.parType[`par${par}` as const];
                return (
                  <div className="st-card" key={par}>
                    <span className="st-card-num mono">
                      {delta == null ? "—" : formatSignedDelta(delta)}
                    </span>
                    <span className="st-card-lbl mono">Par {par}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Distribution per round ──────────────────────────────────── */}
          <section aria-label="Score distribution per round">
            <h2 className="st-label mono">Distribution / rd</h2>
            <div className="st-dist">
              <div className="st-dist-cell">
                <span className="st-dist-num st-dist-good mono">
                  {stats.distribution.birdieOrBetter.toFixed(1)}
                </span>
                <span className="st-dist-lbl mono">Bird+</span>
              </div>
              <div className="st-dist-cell">
                <span className="st-dist-num mono">{stats.distribution.par.toFixed(1)}</span>
                <span className="st-dist-lbl mono">Par</span>
              </div>
              <div className="st-dist-cell">
                <span className="st-dist-num mono">{stats.distribution.bogey.toFixed(1)}</span>
                <span className="st-dist-lbl mono">Bogey</span>
              </div>
              <div className="st-dist-cell">
                <span className="st-dist-num st-dist-bad mono">
                  {stats.distribution.doubleOrWorse.toFixed(1)}
                </span>
                <span className="st-dist-lbl mono">Dbl+</span>
              </div>
            </div>
          </section>

          <p className="st-caption">
            {stats.rounds} round{stats.rounds === 1 ? "" : "s"} in this window · all figures
            derived from hole-by-hole data
          </p>
        </>
      )}

      {/* The listing renders in BOTH branches: it owns its own one-line empty
          state (S10), and the aggregate empty panel above is left untouched. */}
      <RoundList rounds={windowed} window={window} />
    </>
  );
}

/**
 * The putting proportion bar. Widths are the per-round hole-count averages
 * (they sum to the holes-with-putts count, ~18), so the segments are true
 * proportions of the round.
 */
function PuttingBar({
  putting,
}: {
  putting: { onePutt: number; twoPutt: number; threePlus: number };
}) {
  const total = putting.onePutt + putting.twoPutt + putting.threePlus;
  if (total <= 0) return null;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="st-bar" aria-hidden>
      <span className="st-seg st-seg-hit" style={{ width: pct(putting.onePutt) }} />
      <span className="st-seg st-seg-mid" style={{ width: pct(putting.twoPutt) }} />
      <span className="st-seg st-seg-left" style={{ width: pct(putting.threePlus) }} />
    </div>
  );
}
