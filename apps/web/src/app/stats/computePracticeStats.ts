// =============================================================
// Mission S8 — the Stats tab's PRACTICE derivation module (D28).
//
// computePracticeStats(sessions, metricDefs) takes fully-loaded practice
// sessions (session + drill blocks + values + tags + clubs) and returns the
// seven practice stat groups; selectPracticeWindow() applies the three query
// windows (4W / 12W / YTD) on practice_session.date.
//
// Pure: no React, no DB, no I/O, no clock (`today` is a parameter). Same
// pattern as the S6 round module (computeStats.ts) that sits beside it.
//
// THE CORE CONCEPT — OUTING. An outing is the set of sessions sharing one
// calendar date. It is DERIVED here, never a schema entity (D28): the app's
// session types are single-type by design, so one range trip produces two or
// three logged sessions, and the planning-relevant unit is the trip, not the
// row. Two same-day visits collapse into one outing; that is accepted.
//
// SPARSE-DATA HONESTY (D25, carried forward): every figure is a real count
// over what exists. Nothing is smoothed, interpolated, regressed or padded,
// duration coverage always travels with the duration total, and a drill point
// always carries the parameter (Distance) it was logged at.
// =============================================================

// ── Input shapes (mirror the loader in services/api/src/practiceStats.ts) ────

/** One filled metric on a drill block. Only metrics actually entered appear. */
export type PracticeDrillValue = {
  label: string;
  value: number;
};

/** One drill block inside a putting session, in its logged position order. */
export type PracticeDrillBlock = {
  drillTitle: string;
  position: number;
  values: PracticeDrillValue[];
};

/**
 * One logged practice session. `type` is deliberately a plain string, not the
 * live-type union: legacy rows (short_game) must count in volume and mix, and
 * a new type must never crash the view.
 */
export type PracticeStatsSession = {
  id: string;
  /** YYYY-MM-DD — the outing key and the window ordering key. */
  date: string;
  type: string;
  /** Nullable in the schema; coverage is reported, never assumed complete. */
  durationMin: number | null;
  lieTypes: string[];
  shotTypes: string[];
  /** session_club tags, club names only. */
  clubs: string[];
  /** Populated for putting sessions; empty otherwise. */
  blocks: PracticeDrillBlock[];
};

/**
 * A drill's metric definition (drill_metric_def). Shapes the card: `better`
 * picks the primary metric, `unit` marks the parameter axis, `value_type` and
 * `sortOrder` order the rest. Drills are discovered from logged values, not
 * hardcoded — this is the only thing that tells the view what a metric MEANS.
 */
export type PracticeMetricDef = {
  drillTitle: string;
  label: string;
  valueType: string;
  unit: string | null;
  better: "lower" | "higher" | null;
  sortOrder: number | null;
};

// ── Session-type vocabulary ─────────────────────────────────────────────────

/**
 * Display order for the session mix, live types first and legacy last. Types
 * absent from this list still render (appended, labelled by their raw value) —
 * discovery over hardcoding, same rule as the drill cards.
 */
const TYPE_ORDER = ["putting", "trackman", "around_green", "grass_range"] as const;

/** Short labels per the approved mockup ("green", "grass", "legacy"). */
const TYPE_LABELS: Record<string, string> = {
  putting: "putting",
  trackman: "trackman",
  around_green: "green",
  grass_range: "grass",
  short_game: "legacy",
};

/**
 * Retired types (Mission 7 / D-011). Their rows still count in volume and mix
 * but carry no structured stats — no drill blocks, no lie/shot tags. Labelled
 * "legacy" so the surface never implies structure that was never captured.
 */
const LEGACY_TYPES = new Set(["short_game", "net"]);

/**
 * The around-the-green tag vocabulary, from the logging form (formFields.ts
 * LIE_TYPES / SHOT_TYPES). Kept here so a vocabulary entry with ZERO logged
 * sessions still renders as a muted zero chip — absence is information (D28).
 * "bunker" appears in both rows and means different things: the sand LIE and
 * the explosion SHOT.
 */
export const PRACTICE_LIE_TYPES = ["tight", "short rough", "deep rough", "bunker"] as const;
export const PRACTICE_SHOT_TYPES = ["chipping", "pitching", "flops", "bunker"] as const;

// ── Windows ─────────────────────────────────────────────────────────────────

export const PRACTICE_WINDOWS = ["4w", "12w", "ytd"] as const;
export type PracticeWindow = (typeof PRACTICE_WINDOWS)[number];

export const PRACTICE_WINDOW_LABELS: Record<PracticeWindow, string> = {
  "4w": "4W",
  "12w": "12W",
  ytd: "YTD",
};

const DAY_MS = 86_400_000;

/** YYYY-MM-DD to epoch ms at UTC midnight. Clock-free and TZ-free by design. */
function toDayMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

function fromDayMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The Monday on or before `iso` — the calendar-week bucket key. */
export function weekStart(iso: string): string {
  const ms = toDayMs(iso);
  // getUTCDay: 0=Sun..6=Sat. Monday-start means Sunday belongs to the prior week.
  const dow = new Date(ms).getUTCDay();
  const backToMonday = (dow + 6) % 7;
  return fromDayMs(ms - backToMonday * DAY_MS);
}

/**
 * Apply one of the three practice windows to the full session list:
 *   4w  — the 28 days ending on `today` (inclusive)
 *   12w — the 84 days ending on `today` (inclusive)
 *   ytd — sessions dated in `today`'s calendar year
 * Sessions dated after `today` are never included. Order is newest-first;
 * `today` is a parameter (YYYY-MM-DD) so this module stays clock-free.
 *
 * NOTE: practice_session has no is_test column and one is NOT invented here
 * (mission scope item 4) — every logged session is real.
 */
export function selectPracticeWindow(
  sessions: PracticeStatsSession[],
  window: PracticeWindow,
  today: string,
): PracticeStatsSession[] {
  const todayMs = toDayMs(today);
  const byDateDesc = [...sessions].sort((a, b) => b.date.localeCompare(a.date));
  const inRange = byDateDesc.filter((s) => toDayMs(s.date) <= todayMs);

  if (window === "ytd") {
    return inRange.filter((s) => s.date.startsWith(`${today.slice(0, 4)}-`));
  }
  const days = window === "4w" ? 28 : 84;
  const cutoff = todayMs - (days - 1) * DAY_MS;
  return inRange.filter((s) => toDayMs(s.date) >= cutoff);
}

// ── Output shapes ───────────────────────────────────────────────────────────

export type PracticeMixEntry = {
  type: string;
  label: string;
  count: number;
  /** Retired type: counts in volume and mix, contributes no structured stats. */
  legacy: boolean;
};

export type PracticeWeekBar = {
  /** Monday of the calendar week (YYYY-MM-DD). */
  weekStart: string;
  /** OUTINGS in that week — a three-block range day is one unit, not three. */
  outings: number;
};

export type PracticeTagCount = {
  tag: string;
  count: number;
};

/** One plotted drill block: its value, the parameter it was logged at, its date. */
export type PracticeDrillPoint = {
  date: string;
  value: number;
  /** e.g. the Lag Ladder / Circle Drill Distance. Null when the drill has none. */
  parameter: number | null;
  /**
   * Worst value in the window for a lower-is-better metric (and non-zero).
   * Renders coral. NEVER a trend judgment across different parameters — a 2 at
   * 50 ft is not "worse" than a 0 at 25 ft, so the parameter always renders too.
   */
  adverse: boolean;
};

export type PracticeDrillCard = {
  drillTitle: string;
  /** Blocks logged in the window (= points.length). */
  blocks: number;
  /** The scored metric: the metric def carrying `better`. */
  primaryLabel: string;
  better: "lower" | "higher";
  /**
   * The "out of" metric (a unit-less, unscored metric such as Balls), included
   * only when it is CONSTANT across the window — one number can't honestly
   * stand in for a denominator that moved.
   */
  denominator: number | null;
  /** The parameter axis (a metric def with a unit), e.g. Distance / ft. */
  parameterLabel: string | null;
  parameterUnit: string | null;
  /**
   * "strip" — the metric is binary (every value 0 or 1) and lower-is-better, so
   * a line would be false precision: one cell per block, oldest to newest.
   * "trend" — plotted points, oldest to newest, each carrying its parameter.
   */
  render: "strip" | "trend";
  /** Chronological, oldest to newest (session date, then block position). */
  points: PracticeDrillPoint[];
  /** Newest block in the window. */
  latest: PracticeDrillPoint | null;
  /** Strip only: blocks at zero ("N clean of M"). */
  cleanCount: number;
  /**
   * Distinct parameter values present, ascending — the color legend for a
   * higher-is-better drill (Circle Drill: 10 ft / 15 ft today). Empty when the
   * drill has no parameter.
   */
  parameterValues: number[];
};

export type PracticeStatGroups = {
  // ── a. Volume ─────────────────────────────────────────────────────────────
  sessions: number;
  outings: number;
  /** Outings divided by elapsed weeks between the first and last session. */
  outingsPerWeek: number;
  /** The rate's denominator, exposed so the figure is auditable. */
  weeksElapsed: number;
  duration: {
    totalMin: number;
    hours: number;
    /** Sessions carrying a duration_min — the coverage that must always travel. */
    withDuration: number;
    ofSessions: number;
  };
  // ── b. Weekly bars ────────────────────────────────────────────────────────
  weeklyBars: PracticeWeekBar[];
  // ── c. Putting embed rate ─────────────────────────────────────────────────
  puttingEmbed: { outingsWithPutting: number; outings: number };
  // ── d. Session mix ────────────────────────────────────────────────────────
  mix: PracticeMixEntry[];
  // ── e. Drill metrics ──────────────────────────────────────────────────────
  puttingSessions: number;
  drills: PracticeDrillCard[];
  // ── f. Around the green ───────────────────────────────────────────────────
  aroundGreen: {
    sessions: number;
    lies: PracticeTagCount[];
    shots: PracticeTagCount[];
  };
  // ── g. Clubs worked ───────────────────────────────────────────────────────
  clubs: PracticeTagCount[];
  clubTagTotal: number;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── Drill-card derivation ───────────────────────────────────────────────────

type DefIndex = Map<string, PracticeMetricDef[]>;

function indexDefs(defs: PracticeMetricDef[]): DefIndex {
  const byDrill: DefIndex = new Map();
  for (const d of defs) {
    const list = byDrill.get(d.drillTitle) ?? [];
    list.push(d);
    byDrill.set(d.drillTitle, list);
  }
  for (const list of byDrill.values()) {
    list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }
  return byDrill;
}

/**
 * Build one card per drill that has logged values in the window. Drills are
 * DISCOVERED from the data (D28) — the three currently-populated putting drills
 * are today's set, not a fixed list, and a drill seeded tomorrow gets a card
 * with no code change. The metric defs decide the shape:
 *   primary   = the metric carrying `better` (the thing being scored)
 *   parameter = a metric with a unit (Distance / ft) — carried on every point
 *   denominator = a unit-less, unscored metric (Balls), only if it never moved
 * A drill whose defs carry no `better` cannot be scored and is skipped rather
 * than plotted against a guessed direction.
 */
function buildDrillCards(
  sessions: PracticeStatsSession[],
  defs: PracticeMetricDef[],
): PracticeDrillCard[] {
  const byDrill = indexDefs(defs);

  // Chronological: session date, then block position within the session.
  const ordered = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
  type Raw = { date: string; values: Map<string, number> };
  const rawByDrill = new Map<string, Raw[]>();

  for (const s of ordered) {
    const blocks = [...s.blocks].sort((a, b) => a.position - b.position);
    for (const b of blocks) {
      if (b.values.length === 0) continue; // a note-only block records the work, not a datapoint
      const values = new Map<string, number>();
      for (const v of b.values) values.set(v.label, v.value);
      const list = rawByDrill.get(b.drillTitle) ?? [];
      list.push({ date: s.date, values });
      rawByDrill.set(b.drillTitle, list);
    }
  }

  const cards: PracticeDrillCard[] = [];

  for (const [drillTitle, raws] of rawByDrill) {
    const drillDefs = byDrill.get(drillTitle) ?? [];
    const primary = drillDefs.find((d) => d.better != null);
    if (!primary || primary.better == null) continue; // unscored: nothing honest to plot
    const parameter = drillDefs.find((d) => d.better == null && d.unit != null) ?? null;
    const denomDef = drillDefs.find((d) => d.better == null && d.unit == null) ?? null;

    const scored = raws.filter((r) => r.values.has(primary.label));
    if (scored.length === 0) continue;

    const values = scored.map((r) => r.values.get(primary.label) as number);
    const max = Math.max(...values);
    // Binary + lower-is-better means a line would invent precision that isn't
    // there (Gate Drill: 0 or 1+ resets). Render the clean/reset strip instead.
    const binary = values.every((v) => v === 0 || v === 1);
    const render: "strip" | "trend" = primary.better === "lower" && binary ? "strip" : "trend";

    const points: PracticeDrillPoint[] = scored.map((r) => {
      const value = r.values.get(primary.label) as number;
      const param = parameter ? (r.values.get(parameter.label) ?? null) : null;
      const adverse =
        primary.better === "lower" && (render === "strip" ? value > 0 : value === max && max > 0);
      return { date: r.date, value, parameter: param, adverse };
    });

    // A denominator only means something if it held still across the window.
    const denoms = denomDef
      ? scored.map((r) => r.values.get(denomDef.label)).filter((v): v is number => v != null)
      : [];
    const denominator =
      denoms.length === scored.length && denoms.length > 0 && denoms.every((d) => d === denoms[0])
        ? (denoms[0] as number)
        : null;

    const parameterValues = parameter
      ? [...new Set(points.map((p) => p.parameter).filter((v): v is number => v != null))].sort(
          (a, b) => a - b,
        )
      : [];

    cards.push({
      drillTitle,
      blocks: points.length,
      primaryLabel: primary.label,
      better: primary.better,
      denominator,
      parameterLabel: parameter ? parameter.label : null,
      parameterUnit: parameter ? parameter.unit : null,
      render,
      points,
      latest: points.length ? (points[points.length - 1] as PracticeDrillPoint) : null,
      cleanCount: points.filter((p) => p.value === 0).length,
      parameterValues,
    });
  }

  // Most-logged drill first, then alphabetical — a stable order that puts the
  // work actually being done at the top.
  cards.sort((a, b) => b.blocks - a.blocks || a.drillTitle.localeCompare(b.drillTitle));
  return cards;
}

// ── The derivation ──────────────────────────────────────────────────────────

function tagCounts(sessions: PracticeStatsSession[], pick: (s: PracticeStatsSession) => string[],
  vocabulary: readonly string[]): PracticeTagCount[] {
  const counts = new Map<string, number>();
  // Seed the whole vocabulary at zero: a lie/shot type nobody logged renders as
  // a muted x0 chip rather than vanishing. Absence is information (D28).
  for (const t of vocabulary) counts.set(t, 0);
  for (const s of sessions) {
    for (const tag of pick(s)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const known = vocabulary.map((t) => ({ tag: t, count: counts.get(t) ?? 0 }));
  // Anything logged outside the form vocabulary still shows, after the known set.
  const extra = [...counts.entries()]
    .filter(([t]) => !vocabulary.includes(t))
    .map(([tag, count]) => ({ tag, count }));
  return [
    ...known.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    ...extra.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
  ];
}

/**
 * Derive the seven practice stat groups over a window of sessions. Returns null
 * for an empty window — the UI shows a plain empty state, never placeholder
 * numbers. `metricDefs` is the full drill_metric_def table; only the drills
 * with logged values in the window produce cards.
 */
export function computePracticeStats(
  sessions: PracticeStatsSession[],
  metricDefs: PracticeMetricDef[] = [],
): PracticeStatGroups | null {
  if (sessions.length === 0) return null;

  // ── a. Volume ─────────────────────────────────────────────────────────────
  // OUTING = one calendar date's worth of sessions (D28). Everything volume-
  // shaped counts outings, not rows, so a 3-block range day never reads as
  // three trips to the course.
  const dates = [...new Set(sessions.map((s) => s.date))].sort();
  const outings = dates.length;
  const firstMs = toDayMs(dates[0] as string);
  const lastMs = toDayMs(dates[dates.length - 1] as string);

  // Elapsed weeks BETWEEN the first and last session — not the count of calendar
  // weeks touched, which over-counts by up to two partial edge weeks. Floored at
  // one so a single-outing window reports a real rate instead of dividing by zero.
  const weeksElapsed = Math.max(1, (lastMs - firstMs) / DAY_MS / 7);
  const outingsPerWeek = round1(outings / weeksElapsed);

  const withDuration = sessions.filter((s) => s.durationMin != null);
  const totalMin = withDuration.reduce((sum, s) => sum + (s.durationMin as number), 0);

  // ── b. Weekly bars — OUTINGS per calendar week ────────────────────────────
  // Every week from the first session's week to the last is emitted, including
  // the empty ones: a zero week is a real fact about the practice cadence.
  const outingsPerWeekBucket = new Map<string, Set<string>>();
  for (const date of dates) {
    const wk = weekStart(date);
    const set = outingsPerWeekBucket.get(wk) ?? new Set<string>();
    set.add(date);
    outingsPerWeekBucket.set(wk, set);
  }
  const weeklyBars: PracticeWeekBar[] = [];
  for (let ms = toDayMs(weekStart(dates[0] as string)); ms <= lastMs; ms += 7 * DAY_MS) {
    const wk = fromDayMs(ms);
    weeklyBars.push({ weekStart: wk, outings: outingsPerWeekBucket.get(wk)?.size ?? 0 });
  }

  // ── c. Putting embed rate ─────────────────────────────────────────────────
  const puttingDates = new Set(sessions.filter((s) => s.type === "putting").map((s) => s.date));
  const puttingEmbed = { outingsWithPutting: puttingDates.size, outings };

  // ── d. Session mix ────────────────────────────────────────────────────────
  const typeCounts = new Map<string, number>();
  for (const s of sessions) typeCounts.set(s.type, (typeCounts.get(s.type) ?? 0) + 1);
  const mix: PracticeMixEntry[] = [];
  for (const type of TYPE_ORDER) {
    const count = typeCounts.get(type) ?? 0;
    if (count > 0) {
      mix.push({ type, label: TYPE_LABELS[type] ?? type, count, legacy: false });
    }
  }
  // Legacy and any unrecognized type land after the live types, never dropped.
  for (const [type, count] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    if ((TYPE_ORDER as readonly string[]).includes(type)) continue;
    mix.push({
      type,
      label: TYPE_LABELS[type] ?? type,
      count,
      legacy: LEGACY_TYPES.has(type),
    });
  }

  // ── e. Drill metrics ──────────────────────────────────────────────────────
  const puttingSessions = sessions.filter((s) => s.type === "putting");
  const drills = buildDrillCards(puttingSessions, metricDefs);

  // ── f. Around the green ───────────────────────────────────────────────────
  const agSessions = sessions.filter((s) => s.type === "around_green");
  const aroundGreen = {
    sessions: agSessions.length,
    lies: tagCounts(agSessions, (s) => s.lieTypes, PRACTICE_LIE_TYPES),
    shots: tagCounts(agSessions, (s) => s.shotTypes, PRACTICE_SHOT_TYPES),
  };

  // ── g. Clubs worked ───────────────────────────────────────────────────────
  const clubCounts = new Map<string, number>();
  for (const s of sessions) {
    for (const club of s.clubs) clubCounts.set(club, (clubCounts.get(club) ?? 0) + 1);
  }
  const clubs = [...clubCounts.entries()]
    .map(([club, count]) => ({ tag: club, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

  return {
    sessions: sessions.length,
    outings,
    outingsPerWeek,
    weeksElapsed: round1(weeksElapsed),
    duration: {
      totalMin,
      hours: round1(totalMin / 60),
      withDuration: withDuration.length,
      ofSessions: sessions.length,
    },
    weeklyBars,
    puttingEmbed,
    mix,
    puttingSessions: puttingSessions.length,
    drills,
    aroundGreen,
    clubs,
    clubTagTotal: clubs.reduce((sum, c) => sum + c.count, 0),
  };
}

/** "7/21" — the compact point label the drill cards use for a session date. */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}
