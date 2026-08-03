"use client";

import { useMemo, useState } from "react";
import {
  computePracticeStats,
  selectPracticeWindow,
  shortDate,
  PRACTICE_WINDOWS,
  PRACTICE_WINDOW_LABELS,
  type PracticeDrillCard,
  type PracticeMetricDef,
  type PracticeStatsSession,
  type PracticeTagCount,
  type PracticeWindow,
} from "./computePracticeStats";

// =============================================================
// Mission S8 — the PRACTICE half of the Stats tab (D28): three query windows
// over every logged session x the seven practice stat groups, per the approved
// mockup. The server page loads ALL sessions once; a window switch recomputes
// client-side through the same pure computePracticeStats module the tests pin
// — no second derivation path (the S6 rule, applied to practice).
//
// Sparse-data honesty is the house style here: exactly the points that exist,
// no smoothing, no regression lines, no interpolation, no padding.
// =============================================================

/** Distance colors, in order of first appearance. Spec-fixed: green, then #85b7eb. */
const PARAM_COLORS = ["var(--green)", "var(--st-blue)", "var(--st-amber)", "var(--st-muted)"];

function paramColor(index: number): string {
  return PARAM_COLORS[index % PARAM_COLORS.length] as string;
}

export function PracticeView({
  sessions,
  metricDefs,
  today,
}: {
  sessions: PracticeStatsSession[];
  metricDefs: PracticeMetricDef[];
  /** YYYY-MM-DD, resolved on the server — the module itself stays clock-free. */
  today: string;
}) {
  const [window, setWindow] = useState<PracticeWindow>("4w");
  const stats = useMemo(
    () => computePracticeStats(selectPracticeWindow(sessions, window, today), metricDefs),
    [sessions, metricDefs, window, today],
  );

  return (
    <>
      <div className="st-pills" role="tablist" aria-label="Practice window">
        {PRACTICE_WINDOWS.map((w) => (
          <button
            key={w}
            role="tab"
            aria-selected={window === w}
            className={`st-pill mono${window === w ? " on" : ""}`}
            onClick={() => setWindow(w)}
          >
            {PRACTICE_WINDOW_LABELS[w]}
          </button>
        ))}
      </div>

      {stats === null ? (
        <div className="st-empty">
          <p className="st-empty-line mono">No practice logged in this window.</p>
          <p className="st-empty-sub">
            Sessions land here from the Practice tab — the record starts with the first one.
          </p>
        </div>
      ) : (
        <>
          {/* ── a. Volume — outings are the unit, coverage travels with time ── */}
          <section className="st-hero" aria-label="Practice volume">
            <div className="st-hero-cell">
              <span className="st-hero-num mono">{stats.outingsPerWeek.toFixed(1)}</span>
              <span className="st-hero-lbl mono">Outings / wk</span>
            </div>
            <div className="st-hero-cell">
              <span className="st-hero-num mono">{stats.outings}</span>
              <span className="st-hero-lbl mono">
                Outings · {stats.sessions} sessions
              </span>
            </div>
            <div className="st-hero-cell">
              <span className="st-hero-num mono">
                {stats.duration.hours.toFixed(1)}
                <em>h</em>
              </span>
              <span className="st-hero-lbl mono">
                Time · {stats.duration.withDuration} of {stats.duration.ofSessions}
              </span>
            </div>
          </section>

          {/* ── b. Weekly bars — OUTINGS per calendar week, zero weeks included ── */}
          <WeeklyBars bars={stats.weeklyBars} />

          {/* ── d. Session mix ───────────────────────────────────────────────── */}
          <section aria-label="Session mix">
            <h2 className="st-label mono">Session mix · {stats.sessions}</h2>
            <div className="st-bar" aria-hidden>
              {stats.mix.map((m) => (
                <span
                  key={m.type}
                  className={`st-seg ps-mix-${m.legacy ? "legacy" : m.type}`}
                  style={{ width: `${(m.count / stats.sessions) * 100}%` }}
                />
              ))}
            </div>
            <div className="ps-mix-legend mono">
              {stats.mix.map((m) => (
                <span key={m.type} className={`ps-mix-lg ps-mixlg-${m.legacy ? "legacy" : m.type}`}>
                  {m.label} {m.count}
                </span>
              ))}
            </div>
            {/* c. Putting embed rate — how many outings carried putting work. */}
            <p className="ps-note mono">
              putting embedded in {stats.puttingEmbed.outingsWithPutting} of{" "}
              {stats.puttingEmbed.outings} outings
            </p>
          </section>

          {/* ── e. Drill metrics — one card per drill with logged values ─────── */}
          {stats.drills.length > 0 && (
            <section aria-label="Putting drills">
              <h2 className="st-label mono">
                Putting drills · {stats.puttingSessions} session
                {stats.puttingSessions === 1 ? "" : "s"}
              </h2>
              <div className="ps-drills">
                {stats.drills.map((card) => (
                  <DrillCard key={card.drillTitle} card={card} />
                ))}
              </div>
            </section>
          )}

          {/* ── f. Around the green — zero-count chips included ──────────────── */}
          <section aria-label="Around the green">
            <h2 className="st-label mono">
              Around the green · {stats.aroundGreen.sessions} session
              {stats.aroundGreen.sessions === 1 ? "" : "s"}
            </h2>
            <TagRow label="Lies" tags={stats.aroundGreen.lies} />
            <TagRow label="Shots" tags={stats.aroundGreen.shots} />
          </section>

          {/* ── g. Clubs worked ──────────────────────────────────────────────── */}
          <section aria-label="Clubs worked">
            <h2 className="st-label mono">
              Clubs worked · {stats.clubTagTotal} tag{stats.clubTagTotal === 1 ? "" : "s"}
            </h2>
            {stats.clubs.length === 0 ? (
              <p className="st-none">No clubs tagged in this window.</p>
            ) : (
              <div className="ps-chips">
                {stats.clubs.slice(0, 6).map((c) => (
                  <span className="ps-chip" key={c.tag}>
                    {c.tag} <em>×{c.count}</em>
                  </span>
                ))}
                {stats.clubs.length > 6 && (
                  <span className="ps-chip ps-chip-more">+{stats.clubs.length - 6} more</span>
                )}
              </div>
            )}
          </section>

          <p className="st-caption">
            {stats.outings} outing{stats.outings === 1 ? "" : "s"} · {stats.sessions} session
            {stats.sessions === 1 ? "" : "s"} in this window · duration shown for{" "}
            {stats.duration.withDuration} of {stats.duration.ofSessions}
          </p>
        </>
      )}
    </>
  );
}

/**
 * Outings per calendar week. Heights are proportional to the busiest week in
 * the window; a zero week renders as a flat muted stub rather than vanishing —
 * a week off is a real fact about the cadence.
 */
function WeeklyBars({ bars }: { bars: { weekStart: string; outings: number }[] }) {
  const max = Math.max(...bars.map((b) => b.outings), 1);
  const first = bars[0];
  const last = bars[bars.length - 1];
  return (
    <section aria-label="Outings per week">
      <div className="ps-bars">
        {bars.map((b) => (
          <div className="ps-barcol" key={b.weekStart} title={`${b.weekStart}: ${b.outings}`}>
            <span
              className={`ps-bar${b.outings === 0 ? " zero" : ""}`}
              style={{ height: `${b.outings === 0 ? 8 : 14 + (b.outings / max) * 54}px` }}
            />
          </div>
        ))}
      </div>
      <div className="ps-bars-axis mono">
        <span>{first ? `wk ${shortDate(first.weekStart)}` : ""}</span>
        <span className="ps-bars-cap">outings per week</span>
        <span>{last ? `wk ${shortDate(last.weekStart)}` : ""}</span>
      </div>
    </section>
  );
}

/** A lie/shot tag row. Zero-count chips render muted — absence is information. */
function TagRow({ label, tags }: { label: string; tags: PracticeTagCount[] }) {
  return (
    <div className="ps-tagrow">
      <span className="ps-tagrow-lbl mono">{label}</span>
      <div className="ps-chips">
        {tags.map((t) => (
          <span className={`ps-chip${t.count === 0 ? " ps-chip-zero" : ""}`} key={t.tag}>
            {t.tag} <em>×{t.count}</em>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * One drill card. The header always carries the latest value WITH its parameter
 * context ("0 @ 25ft latest") and the block count; the body is either the
 * clean/reset strip (binary metric) or the point plot (everything else). The
 * shape comes from drill_metric_def, so a drill this code has never seen still
 * renders correctly.
 */
function DrillCard({ card }: { card: PracticeDrillCard }) {
  const unit = card.parameterUnit ?? "";
  const latestText = card.latest
    ? card.latest.parameter != null
      ? `${card.latest.value} @ ${card.latest.parameter}${unit} latest`
      : `${card.latest.value} latest`
    : "";

  return (
    <article className="ps-drill">
      <header className="ps-drill-hd">
        <span className="ps-drill-name mono">{card.drillTitle}</span>
        <span className="ps-drill-metric mono">
          {card.primaryLabel.toLowerCase()}
          {card.denominator != null ? ` / ${card.denominator}` : ""}
        </span>
        <span className="ps-drill-latest mono">
          <b className={card.latest?.adverse ? "adverse" : "good"}>{card.latest?.value ?? "—"}</b>{" "}
          {card.latest && card.latest.parameter != null
            ? `@ ${card.latest.parameter}${unit} latest`
            : "latest"}
          {card.render === "strip" && ` · ${card.cleanCount} clean of ${card.blocks}`}
        </span>
      </header>

      {card.render === "strip" ? (
        <>
          <div className="ps-strip" role="img" aria-label={latestText}>
            {card.points.map((p, i) => (
              <span
                key={`${p.date}-${i}`}
                className={`ps-cell${p.adverse ? " adverse" : ""}`}
                title={`${shortDate(p.date)}: ${p.value}`}
              />
            ))}
          </div>
          <p className="ps-drill-cap">
            green = 0 {card.primaryLabel.toLowerCase()} · coral = 1+ · oldest → newest
          </p>
        </>
      ) : (
        <DrillTrend card={card} />
      )}
    </article>
  );
}

/**
 * The point plot. Points are placed chronologically and evenly — the x axis is
 * block ORDER, never elapsed time, and there is no line between them: the
 * blocks were logged at different parameters and a connecting line would imply
 * a comparison that isn't valid.
 *
 * Lower-is-better (Lag Ladder): each point prints the parameter it was logged
 * at, and the window's worst values are coral. Higher-is-better (Circle Drill):
 * points are colored BY parameter with a legend, and print their value.
 */
function DrillTrend({ card }: { card: PracticeDrillCard }) {
  const W = 320;
  const TOP = 16;
  const BASE = 54;
  const PAD = 16;
  const n = card.points.length;
  const maxV = Math.max(...card.points.map((p) => p.value), 1);
  const colorByParam = card.better === "higher" && card.parameterValues.length > 0;

  const x = (i: number) => (n === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (n - 1));
  const y = (v: number) => BASE - (v / maxV) * (BASE - TOP);

  const dotColor = (p: { value: number; parameter: number | null; adverse: boolean }) => {
    if (colorByParam && p.parameter != null) {
      return paramColor(card.parameterValues.indexOf(p.parameter));
    }
    return p.adverse ? "var(--st-coral)" : "var(--green)";
  };

  return (
    <>
      <svg
        className="ps-plot"
        viewBox={`0 0 ${W} ${card.better === "lower" ? 76 : 68}`}
        role="img"
        aria-label={`${card.drillTitle}: ${card.points
          .map((p) => `${p.value}${p.parameter != null ? ` at ${p.parameter}${card.parameterUnit ?? ""}` : ""}`)
          .join(", ")}`}
      >
        {/* Baseline only — no gridlines, no trendline, no interpolation. */}
        <line x1={PAD - 6} y1={BASE} x2={W - PAD + 6} y2={BASE} stroke="var(--st-border)" strokeWidth="1" />
        {card.points.map((p, i) => (
          <g key={`${p.date}-${i}`}>
            {card.better === "higher" && (
              <text className="ps-plot-val" x={x(i)} y={y(p.value) - 9} textAnchor="middle">
                {p.value}
              </text>
            )}
            <circle cx={x(i)} cy={y(p.value)} r="5" fill={dotColor(p)} />
            {card.better === "lower" && p.parameter != null && (
              <text className="ps-plot-param" x={x(i)} y={BASE + 14} textAnchor="middle">
                {p.parameter}
              </text>
            )}
          </g>
        ))}
      </svg>

      {colorByParam && card.parameterValues.length > 0 && (
        <div className="ps-legend mono">
          {card.parameterValues.map((v, i) => (
            <span key={v}>
              <i style={{ background: paramColor(i) }} /> {v} {card.parameterUnit ?? ""}
            </span>
          ))}
        </div>
      )}
      {card.better === "lower" && card.parameterLabel && (
        <p className="ps-drill-cap">
          dot label = {card.parameterLabel.toLowerCase()}
          {card.parameterUnit ? ` (${card.parameterUnit})` : ""} · coral = worst in window ·{" "}
          {card.blocks} block{card.blocks === 1 ? "" : "s"}
        </p>
      )}
      {card.better === "higher" && (
        <p className="ps-drill-cap">
          {card.blocks} block{card.blocks === 1 ? "" : "s"} · oldest → newest
        </p>
      )}
    </>
  );
}
