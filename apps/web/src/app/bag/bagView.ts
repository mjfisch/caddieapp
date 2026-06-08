// Mission 3a — Bag tab presentation helpers. PURE: no React, no I/O, no
// server-only. The server hands over canonical `BagClub` rows; these functions
// turn each into exactly what a row shows. Kept separate from page.tsx so the
// dual-confidence rules (invariant #2) are unit-tested directly, not via render.

import type { ConfidenceFlag } from "@gai/shared";

/** The display shape the page consumes — mirrors @gai/api's BagClub (no server import). */
export type BagClubView = {
  club: string;
  carryYards: number;
  lateralSdYards: number;
  shotCount: number;
  confidence: ConfidenceFlag;
  lastSession: string | null;
};

// ── Club display names ────────────────────────────────────────────────────────
// Canonical ids → the prototype's bag labels. Wedges read "<loft>° <name>".

const WEDGE_LABELS: Record<string, string> = {
  PW: "PW",
  GW50: "50° GW",
  SW54: "54° SW",
  LW60: "60° LW",
  LW64: "64° LW",
};

/** "driver"→"Driver", "7i"→"7-iron", "3h"→"3-hybrid", "GW50"→"50° GW". */
export function clubDisplayName(club: string): string {
  if (club === "driver") return "Driver";
  if (WEDGE_LABELS[club]) return WEDGE_LABELS[club]!;
  const iron = /^(\d{1,2})i$/.exec(club);
  if (iron) return `${iron[1]}-iron`;
  const hybrid = /^(\d{1,2})h$/.exec(club);
  if (hybrid) return `${hybrid[1]}-hybrid`;
  const wood = /^(\d{1,2})w$/.exec(club);
  if (wood) return `${wood[1]}-wood`;
  return club; // unknown id — show it verbatim rather than hide a club
}

// ── Dispersion rating (consistency QUALITY) ─────────────────────────────────────
// The dataset records measured lateral SD in YARDS, not an ordinal score — so we
// show the real ±yd and band it into Tight / Steady / Loose. Color encodes
// consistency quality ONLY (green/amber/red); it never encodes confidence. The
// thresholds are a display banding over the canonical lateral SD — not SG math.

export type DispersionLevel = "tight" | "steady" | "loose";

/** ≤5 yd lateral SD = Tight, ≤9 = Steady, >9 = Loose. Lower is tighter. */
const TIGHT_MAX_YDS = 5;
const STEADY_MAX_YDS = 9;
/** Bar saturates here (≈ driver, the widest club) — fuller bar = looser. */
const BAR_FULL_YDS = 18;

export type DispersionBand = {
  level: DispersionLevel;
  /** Capitalized word shown next to the dot. */
  word: string;
  /** Confidence color token (green/amber/red) — consistency quality, not certainty. */
  color: string;
  /** Bar fill fraction 0–1: proportional to looseness (lateral SD ÷ full scale). */
  fill: number;
};

export function dispersionBand(lateralSdYards: number): DispersionBand {
  const fill = Math.max(0.08, Math.min(1, lateralSdYards / BAR_FULL_YDS));
  if (lateralSdYards <= TIGHT_MAX_YDS) {
    return { level: "tight", word: "Tight", color: "var(--green)", fill };
  }
  if (lateralSdYards <= STEADY_MAX_YDS) {
    return { level: "steady", word: "Steady", color: "var(--amber)", fill };
  }
  return { level: "loose", word: "Loose", color: "var(--red)", fill };
}

// ── Dual confidence (invariant #2, the centerpiece) ─────────────────────────────
// Carry certainty and dispersion certainty are resolved INDEPENDENTLY and shown
// in two different ways — never by recoloring the rating.

/** ≥ this many real shots is the bar a dispersion rating must clear to be trusted. */
export const MEASURED_SAMPLE_MIN = 5;

/**
 * The left-hand carry-confidence line: a measured club shows its last-measured
 * date; anything else reads "Not yet measured". Carry trust is about the date,
 * not the spread.
 */
export function carryConfidenceLine(c: BagClubView): string {
  if (c.confidence === "measured" && c.lastSession) return formatSessionDate(c.lastSession);
  return "Not yet measured";
}

/**
 * Whether the DISPERSION rating should render muted / "est." — i.e. it is NOT
 * backed by a measured shot sample. A rating that is seeded-from-benchmark (or
 * partial, or thin-sampled) must read as an estimate even when the carry itself
 * is solid. Conservative fallback for the missing dispersion-confidence field
 * (see DATA-MODEL GAP note in page.tsx): trust the row's flag, and additionally
 * require a real sample of MEASURED_SAMPLE_MIN+ shots. Do not fabricate certainty.
 */
export function isDispersionEstimated(c: BagClubView): boolean {
  return c.confidence !== "measured" || c.shotCount < MEASURED_SAMPLE_MIN;
}

// ── Card 1 — shot-count progress (Mission 3b, COMPUTED) ─────────────────────────
// A plain query + threshold check, NOT an LLM call (invariant #1: the math/voice
// boundary). Each bag club needs SHOT_TARGET measured shots before its dispersion
// is considered fully built out; this tallies how many clear the bar and names
// the ones that don't, in the list's carry-desc order.

/** Measured-shot target per club for a fully built-out dispersion sample. */
export const SHOT_TARGET = 20;

export type ShotProgress = {
  /** Total bag clubs considered. */
  total: number;
  /** How many have reached SHOT_TARGET measured shots. */
  reached: number;
  /** Display names of the clubs still below the target (carry-desc order). */
  below: string[];
  /** True only when every club has hit the target (the goal state). */
  allReached: boolean;
};

/**
 * Tally bag clubs against the 20-shot target from a club → live-count map (the
 * shot-log counts; a missing club key counts as 0). Returns the figures Card 1
 * narrates: N of total reached, and the named list still needing data.
 */
export function shotDataProgress(
  clubs: BagClubView[],
  counts: Record<string, number>,
  target: number = SHOT_TARGET,
): ShotProgress {
  const below: string[] = [];
  let reached = 0;
  for (const c of clubs) {
    if ((counts[c.club] ?? 0) >= target) reached++;
    else below.push(clubDisplayName(c.club));
  }
  return { total: clubs.length, reached, below, allReached: below.length === 0 };
}

// ── Carry & consistency RATING map (Mission 3b) ─────────────────────────────────
// A consistency visualization, NOT a true shot-dispersion pattern. The canonical
// dataset has no ordinal 1–N rating (mission 3a) — only measured lateral SD in
// yards, banded Tight/Steady/Loose (dispersionBand). So both the ellipse COLOR
// and its SIZE come from that same band: looser band → larger, redder ellipse.
// The size is an ABSTRACT rating encoding (the band's looseness fill), DELIBERATELY
// not a yard-scaled projection of lateral spread — lateral SD isn't reliably
// measured for most clubs, so we never draw it to scale. The one real spatial
// axis is X = carry mean (yards). Clubs stack diagonally by carry rank (driver
// top-right → shortest wedge bottom-left). Seeded/partial clubs render muted
// (isDispersionEstimated), carrying the list's dual confidence onto the map.

const MAP_W = 320;
const MAP_PAD_L = 40; // room for the leftmost ellipse + its label
const MAP_PAD_R = 24; // room for the driver ellipse near the right edge
const MAP_PAD_TOP = 30; // below the carry-axis number labels
const MAP_PAD_BOTTOM = 18;
const MAP_ROW_STEP = 20; // vertical gap between stacked clubs
/** Fixed carry domain so the 100/150/200/250 gridlines always land consistently. */
const MAP_CARRY_MIN = 60;
const MAP_CARRY_MAX = 285;
const MAP_GRID_CARRIES = [100, 150, 200, 250] as const;
/** Ellipse radii scale linearly with band looseness fill (0.08–1). Both dimensions. */
const MAP_RX_MIN = 11;
const MAP_RX_SPAN = 15;
const MAP_RY_MIN = 4.5;
const MAP_RY_SPAN = 4;
/** Measured ratings render bold; estimated (seeded/partial) ones drop to ~40% (token). */
const MAP_OPACITY_MEASURED = 0.9;
const MAP_OPACITY_ESTIMATED = 0.4;

export type CarryMapPoint = {
  club: string;
  label: string;
  carry: number;
  /** Ellipse center: x = carry, y = diagonal stack position by carry rank. */
  cx: number;
  cy: number;
  /** Radii — proportional to the consistency rating (looser = larger). */
  rx: number;
  ry: number;
  /** Band color (consistency quality), matching the ALL CLUBS list. */
  color: string;
  level: DispersionLevel;
  /** Whether the rating is an estimate (drives the muted opacity). */
  estimated: boolean;
  opacity: number;
};

export type CarryMapModel = {
  width: number;
  height: number;
  /** Y-span the vertical gridlines occupy (below the axis labels, to the floor). */
  gridTop: number;
  gridBottom: number;
  gridLines: { carry: number; x: number }[];
  points: CarryMapPoint[];
};

/**
 * Build the carry & consistency map model from the bag (expected in carry-desc
 * order, as getBagClubs returns it). Pure geometry over the canonical numbers —
 * no SG compute, no I/O. The page renders the returned coordinates as SVG.
 */
export function buildCarryMap(clubs: BagClubView[]): CarryMapModel {
  const plotW = MAP_W - MAP_PAD_L - MAP_PAD_R;
  const xFor = (carry: number): number =>
    MAP_PAD_L + ((carry - MAP_CARRY_MIN) / (MAP_CARRY_MAX - MAP_CARRY_MIN)) * plotW;

  const height = MAP_PAD_TOP + Math.max(0, clubs.length - 1) * MAP_ROW_STEP + MAP_PAD_BOTTOM;
  const gridTop = 16;
  const gridBottom = height - 4;

  const gridLines = MAP_GRID_CARRIES.map((carry) => ({ carry, x: xFor(carry) }));

  const points: CarryMapPoint[] = clubs.map((c, i) => {
    const band = dispersionBand(c.lateralSdYards);
    const estimated = isDispersionEstimated(c);
    return {
      club: c.club,
      label: clubDisplayName(c.club),
      carry: c.carryYards,
      cx: xFor(c.carryYards),
      cy: MAP_PAD_TOP + i * MAP_ROW_STEP,
      rx: MAP_RX_MIN + band.fill * MAP_RX_SPAN,
      ry: MAP_RY_MIN + band.fill * MAP_RY_SPAN,
      color: band.color,
      level: band.level,
      estimated,
      opacity: estimated ? MAP_OPACITY_ESTIMATED : MAP_OPACITY_MEASURED,
    };
  });

  return { width: MAP_W, height, gridTop, gridBottom, gridLines, points };
}

// ── Dates ──────────────────────────────────────────────────────────────────────

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-05-18" → "May 18, 2026". Pure string parse (no Date/TZ surprises). */
export function formatSessionDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return `${MONTHS[Number(mo) - 1]} ${Number(d)}, ${y}`;
}

/** Header "last session": the most recent date across the bag, formatted (or null). */
export function latestSession(clubs: BagClubView[]): string | null {
  const dates = clubs.map((c) => c.lastSession).filter((d): d is string => !!d);
  if (dates.length === 0) return null;
  return formatSessionDate(dates.sort().at(-1)!);
}
