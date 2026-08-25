"use client";

import { useState } from "react";
import {
  computeStats,
  formatRoundDate,
  formatSignedDelta,
  formatVsPar,
  roundGross,
  roundParTotal,
  scoreMark,
  splitNines,
  type NineView,
  type StatsHole,
  type StatsRound,
} from "./computeStats";

// =============================================================
// Mission S10 — the round-by-round listing beneath the aggregate cards.
//
// Read-only. It consumes the SAME windowed array the aggregate cards are
// derived from (StatsView passes selectWindow()'s output to both), so there is
// exactly one filter control on the page and no second selection path — the
// Hcp 8 differential-ascending order comes straight out of selectWindow().
//
// Every footer figure is computeStats([round]) — the aggregate rollup called
// with n=1, never a second implementation. A one-round window's cards and that
// round's footer are then the same numbers by construction (D25).
//
// Every row is collapsed on load, including the newest; rows open independently.
// An empty window renders nothing — the aggregate view owns that message.
// =============================================================

export function RoundList({ rounds }: { rounds: StatsRound[] }) {
  // A set, not a single id: opening one round never closes another. Empty on
  // mount — no round is expanded by default.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // An empty window renders NOTHING here — the aggregate view above already
  // says the window is empty, and two stacked messages read worse than one.
  if (rounds.length === 0) return null;

  return (
    <section aria-label="Round by round">
      <h2 className="st-label mono">Round by round</h2>
      <div className="rl-list">
        {rounds.map((round) => (
          <RoundRow
            key={round.id}
            round={round}
            expanded={open.has(round.id)}
            onToggle={() => toggle(round.id)}
          />
        ))}
      </div>
    </section>
  );
}

function RoundRow({
  round,
  expanded,
  onToggle,
}: {
  round: StatsRound;
  expanded: boolean;
  onToggle: () => void;
}) {
  const gross = roundGross(round);
  const par = roundParTotal(round);
  const panelId = `rl-panel-${round.id}`;

  return (
    <div className="rl-item">
      <button
        type="button"
        className="rl-row mono"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span className="rl-meta">
          <span className="rl-date">{formatRoundDate(round.playedDate)}</span>
          <span className="rl-course">
            {round.courseName} · {round.teeName}
          </span>
        </span>
        <span className="rl-score">
          {gross}
          {par != null && <em className="rl-topar">{formatVsPar(gross - par)}</em>}
        </span>
        <span className="rl-diff">{round.differential.toFixed(1)}</span>
      </button>

      <div className="rl-panel" id={panelId} hidden={!expanded}>
        {/* Mounted collapsed too: the data is already client-side, so `hidden`
            costs nothing and keeps the panel in the a11y tree's document order. */}
        <RoundScorecard round={round} />
      </div>
    </div>
  );
}

function RoundScorecard({ round }: { round: StatsRound }) {
  const { front, back } = splitNines(round);
  // THE rollup, with n=1 — the aggregate cards' own function (invariant: one
  // derivation path). Non-null because a listed round always has holes.
  const stats = computeStats([round]);

  return (
    <>
      {front && <NineTable nine={front} start={1} />}
      {back && <NineTable nine={back} start={10} />}

      {stats && (
        <div className="rl-foot">
          <div className="rl-fgrid">
            <FootCell value={`${stats.girPct.toFixed(1)}`} unit="%" label="GIR" />
            <FootCell
              value={stats.fairways ? stats.fairways.hitPct.toFixed(1) : "—"}
              unit={stats.fairways ? "%" : undefined}
              label="Fairways"
            />
            <FootCell
              value={stats.putting ? String(stats.putting.avgPutts) : "—"}
              label="Putts"
            />
            <FootCell value={String(stats.distribution.doubleOrWorse)} label="Dbl+" />
          </div>
          <div className="rl-parline mono">
            {([3, 4, 5] as const).map((par) => {
              const delta = stats.parType[`par${par}` as const];
              return (
                <span key={par}>
                  Par {par}
                  <b>{delta == null ? "—" : formatSignedDelta(delta)}</b>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function FootCell({
  value,
  unit,
  label,
}: {
  value: string;
  unit?: string;
  label: string;
}) {
  return (
    <div>
      <b className="mono">
        {value}
        {unit && <small>{unit}</small>}
      </b>
      <span className="mono">{label}</span>
    </div>
  );
}

/**
 * One nine as the Option A grid: label column + nine hole columns + the Out/In
 * total. Holes are indexed by number so a gap in the round (an unrecorded
 * hole) renders an empty cell rather than shifting every column left.
 */
function NineTable({ nine, start }: { nine: NineView; start: number }) {
  const byNumber = new Map(nine.holes.map((h) => [h.holeNumber, h]));
  const numbers = Array.from({ length: 9 }, (_, i) => start + i);
  const cells = numbers.map((n) => byNumber.get(n) ?? null);
  const scored = nine.holes.filter((h) => h.fairwayResult != null).length;

  return (
    <table className="rl-card mono">
      <caption className="rl-caption">
        {start === 1 ? "Front nine" : "Back nine"}
      </caption>
      <thead>
        <tr>
          <th scope="col">
            <span className="rl-hidden">Row</span>
          </th>
          {numbers.map((n) => (
            <th scope="col" key={n}>
              {n}
            </th>
          ))}
          <th scope="col">{nine.label}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">Par</th>
          {cells.map((h, i) => (
            <td key={numbers[i]}>{h?.par ?? "–"}</td>
          ))}
          <td>{nine.par ?? "–"}</td>
        </tr>

        <tr className="rl-score-row">
          <th scope="row">Score</th>
          {cells.map((h, i) => (
            <td key={numbers[i]}>{h ? <ScoreCell hole={h} /> : "–"}</td>
          ))}
          <td>{nine.strokes}</td>
        </tr>

        <tr>
          <th scope="row">Putts</th>
          {cells.map((h, i) => (
            <td key={numbers[i]}>{h?.putts ?? "–"}</td>
          ))}
          <td>{nine.putts ?? "–"}</td>
        </tr>

        <tr>
          <th scope="row">GIR</th>
          {cells.map((h, i) => (
            <td key={numbers[i]}>
              {h?.gir === true ? (
                <Glyph className="rl-gir-y" glyph="✓" label="green hit" />
              ) : h?.gir === false ? (
                <Glyph className="rl-gir-n" glyph="✗" label="green missed" />
              ) : (
                <Glyph className="rl-dim" glyph="–" label="no data" />
              )}
            </td>
          ))}
          <td>{nine.gir}</td>
        </tr>

        <tr>
          <th scope="row">Tee</th>
          {cells.map((h, i) => (
            <td key={numbers[i]}>
              <TeeCell hole={h} />
            </td>
          ))}
          {/* Fairways hit out of the nine's known-direction holes — par 3s and
              unknown-direction rows are not in the denominator, exactly as the
              aggregate split treats them. */}
          <td>
            {nine.fairways}
            <span className="rl-hidden"> of {scored} fairways hit</span>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** Paper-scorecard marks: circled under par, boxed over it, par unmarked. */
function ScoreCell({ hole }: { hole: StatsHole }) {
  const mark = scoreMark(hole);
  const cls =
    mark === "eagle"
      ? " rl-mark rl-eagle"
      : mark === "birdie"
        ? " rl-mark rl-birdie"
        : mark === "bogey" || mark === "double"
          ? " rl-mark rl-bogey"
          : "";
  return (
    <span className={`rl-strokes${cls}`}>
      {hole.strokes}
      {mark !== "par" && mark !== "none" && (
        <span className="rl-hidden"> ({MARK_LABELS[mark]})</span>
      )}
    </span>
  );
}

const MARK_LABELS: Record<string, string> = {
  eagle: "eagle or better",
  birdie: "birdie",
  bogey: "bogey",
  double: "double bogey or worse",
};

/**
 * L / ✓ / R / – in the same left-hit-right colours as the aggregate FAIRWAYS
 * bar. The letter carries the direction, so hue is never the only channel.
 */
function TeeCell({ hole }: { hole: StatsHole | null }) {
  if (!hole || hole.fairwayResult == null) {
    return <Glyph className="rl-dim" glyph="–" label="no fairway" />;
  }
  if (hole.fairwayResult === "hit") {
    return <Glyph className="rl-fw-h" glyph="✓" label="fairway hit" />;
  }
  if (hole.fairwayResult === "miss_left") {
    return <Glyph className="rl-fw-l" glyph="L" label="missed left" />;
  }
  return <Glyph className="rl-fw-r" glyph="R" label="missed right" />;
}

/** A symbol plus the words it stands for — the glyph alone is not the meaning. */
function Glyph({
  className,
  glyph,
  label,
}: {
  className: string;
  glyph: string;
  label: string;
}) {
  return (
    <span className={className}>
      <span aria-hidden="true">{glyph}</span>
      <span className="rl-hidden">{label}</span>
    </span>
  );
}
