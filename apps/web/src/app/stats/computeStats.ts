// =============================================================
// Mission S6 — the Stats tab's pure derivation module (design doc §4; D24/D25).
//
// computeStats(rounds) takes fully-loaded rounds (round + holes) and returns
// the seven stat groups; selectWindow() applies the three query windows
// (Last 20 / YTD / Hcp 8). All stats are DERIVED, never stored — this module
// is the ONE place the derivation runs, whether the caller is the server page,
// the client filter switch, or a credential-free unit test.
//
// Pure: no React, no DB, no I/O, no clock (the YTD year is a parameter).
// Mirrors the bagView.ts pattern — a plain module next to the page it feeds.
// =============================================================

export type StatsFairwayResult = "hit" | "miss_left" | "miss_right";

export type StatsHole = {
  /** From the course model (positional join) — null when the hole row is missing. */
  par: number | null;
  strokes: number;
  putts: number | null;
  /** NULL = par 3 or unknown-direction legacy row — never counted in the split. */
  fairwayResult: StatsFairwayResult | null;
  gir: boolean | null;
};

export type StatsRound = {
  /** YYYY-MM-DD — the window ordering key (the round table's played_date). */
  playedDate: string;
  /** Stored on the round, never computed in-app (D23). */
  differential: number;
  /** Test rounds are kept (D24) but excluded from every window (design doc §4). */
  isTest: boolean;
  holes: StatsHole[];
};

export type StatGroups = {
  /** How many rounds this window actually holds — sparse-data honesty. */
  rounds: number;
  /** 1 dp. Group 1 — average gross score. */
  avgScore: number;
  /** 1 dp. Group 2 — average differential. */
  avgDifferential: number;
  /**
   * Group 3 — three-way fairway split, 1 dp each. Denominator is holes with a
   * known fairway_result only (par 3s and unknown-direction rows never count),
   * so the raw fractions are exhaustive and sum to 100. Null when the window
   * has no known-direction holes at all — never a fabricated split.
   */
  fairways: { hitPct: number; missLeftPct: number; missRightPct: number } | null;
  /** 1 dp. Group 4 — gir=true holes over holes played, per round, averaged. */
  girPct: number;
  /**
   * Group 5 — putting, 1 dp each: average total putts per round plus the
   * average per-round count of 1-putt / 2-putt / 3+ putt holes. Null when no
   * hole in the window has a recorded putt count.
   */
  putting: { avgPutts: number; onePutt: number; twoPutt: number; threePlus: number } | null;
  /**
   * Group 6 — average strokes-vs-par delta per hole, by par type, 2 dp
   * (display with explicit sign via formatSignedDelta). Null per type when the
   * window has no holes of that par.
   */
  parType: { par3: number | null; par4: number | null; par5: number | null };
  /** Group 7 — average per-round counts, 1 dp each. */
  distribution: { birdieOrBetter: number; par: number; bogey: number; doubleOrWorse: number };
};

export const STATS_WINDOWS = ["last20", "ytd", "hcp8"] as const;
export type StatsWindow = (typeof STATS_WINDOWS)[number];

export const STATS_WINDOW_LABELS: Record<StatsWindow, string> = {
  last20: "Last 20",
  ytd: "YTD",
  hcp8: "Hcp 8",
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Display form for a par-type delta: explicit sign, 2 decimals ("+0.30"). */
export function formatSignedDelta(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
}

/**
 * Apply one of the three query windows (design doc §4) to the full round list:
 *   last20 — the 20 most recent by played_date
 *   ytd    — rounds dated in `currentYear`
 *   hcp8   — the 8 lowest differentials among the Last 20 (all of them if <8)
 * Test rounds are excluded from every window. Order within the window is
 * newest-first; ties keep the caller's order (the loader breaks date ties on
 * created_at). `currentYear` is a parameter so the module stays clock-free.
 */
export function selectWindow(
  rounds: StatsRound[],
  window: StatsWindow,
  currentYear: number,
): StatsRound[] {
  const real = rounds.filter((r) => !r.isTest);
  // Stable sort, newest first — ISO dates compare lexicographically.
  const byDateDesc = [...real].sort((a, b) => b.playedDate.localeCompare(a.playedDate));

  switch (window) {
    case "last20":
      return byDateDesc.slice(0, 20);
    case "ytd":
      return byDateDesc.filter((r) => r.playedDate.startsWith(`${currentYear}-`));
    case "hcp8":
      return [...byDateDesc.slice(0, 20)]
        .sort((a, b) => a.differential - b.differential)
        .slice(0, 8);
  }
}

/**
 * Derive the seven stat groups over a window of rounds. Returns null for an
 * empty window — the UI shows a plain empty state, never placeholder numbers.
 * With few rounds the figures are real averages over what exists (D25 —
 * never pad, never fake).
 */
export function computeStats(rounds: StatsRound[]): StatGroups | null {
  const n = rounds.length;
  if (n === 0) return null;

  const allHoles = rounds.flatMap((r) => r.holes);

  // ── 1 & 2: average gross score / average differential ─────────────────────
  const avgScore = rounds.reduce((s, r) => s + r.holes.reduce((t, h) => t + h.strokes, 0), 0) / n;
  const avgDifferential = rounds.reduce((s, r) => s + r.differential, 0) / n;

  // ── 3: fairway split — known-direction holes only, exhaustive three ways ──
  const fwHoles = allHoles.filter((h) => h.fairwayResult != null);
  const fairways = fwHoles.length
    ? {
        hitPct: round1(
          (fwHoles.filter((h) => h.fairwayResult === "hit").length / fwHoles.length) * 100,
        ),
        missLeftPct: round1(
          (fwHoles.filter((h) => h.fairwayResult === "miss_left").length / fwHoles.length) * 100,
        ),
        missRightPct: round1(
          (fwHoles.filter((h) => h.fairwayResult === "miss_right").length / fwHoles.length) * 100,
        ),
      }
    : null;

  // ── 4: GIR% — greens hit over holes played, per round, averaged ───────────
  const girRates = rounds
    .filter((r) => r.holes.length > 0)
    .map((r) => r.holes.filter((h) => h.gir === true).length / r.holes.length);
  const girPct = girRates.length
    ? round1((girRates.reduce((s, x) => s + x, 0) / girRates.length) * 100)
    : 0;

  // ── 5: putting — per-round totals + 1/2/3+ putt hole counts, averaged ─────
  const hasPutts = allHoles.some((h) => h.putts != null);
  const putting = hasPutts
    ? {
        avgPutts: round1(
          rounds.reduce((s, r) => s + r.holes.reduce((t, h) => t + (h.putts ?? 0), 0), 0) / n,
        ),
        onePutt: round1(allHoles.filter((h) => h.putts === 1).length / n),
        twoPutt: round1(allHoles.filter((h) => h.putts === 2).length / n),
        threePlus: round1(allHoles.filter((h) => h.putts != null && h.putts >= 3).length / n),
      }
    : null;

  // ── 6: strokes-vs-par delta per hole, by par type ──────────────────────────
  const deltaFor = (par: number): number | null => {
    const holes = allHoles.filter((h) => h.par === par);
    if (!holes.length) return null;
    return round2(holes.reduce((s, h) => s + (h.strokes - par), 0) / holes.length);
  };
  const parType = { par3: deltaFor(3), par4: deltaFor(4), par5: deltaFor(5) };

  // ── 7: score distribution per round ────────────────────────────────────────
  // Holes without a par (missing course row) can't be classified and are
  // excluded rather than guessed.
  const scored = allHoles.filter((h) => h.par != null);
  const diff = (h: StatsHole) => h.strokes - (h.par as number);
  const distribution = {
    birdieOrBetter: round1(scored.filter((h) => diff(h) <= -1).length / n),
    par: round1(scored.filter((h) => diff(h) === 0).length / n),
    bogey: round1(scored.filter((h) => diff(h) === 1).length / n),
    doubleOrWorse: round1(scored.filter((h) => diff(h) >= 2).length / n),
  };

  return {
    rounds: n,
    avgScore: round1(avgScore),
    avgDifferential: round1(avgDifferential),
    fairways,
    girPct,
    putting,
    parType,
    distribution,
  };
}
