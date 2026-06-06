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
