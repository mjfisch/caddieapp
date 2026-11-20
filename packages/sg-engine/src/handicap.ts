// World Handicap System (WHS) Handicap Index — pure arithmetic, no I/O, no clock
// (invariant #1: the math runs here, in code; nothing downstream recomputes it).
//
// Input is the round table's STORED score differentials (D23: a differential is
// captured on the payload, never computed in-app). This module only applies the
// WHS "lowest N of the most recent 20" table to them.
//
// Deliberately NOT applied (documented, not forgotten):
//   - Soft cap / hard cap (WHS Rule 5.8). Both are measured against a Low
//     Handicap Index — the lowest index over the prior 365 days — and the app
//     keeps no index history to take that from.
//   - Exceptional Score Reduction (Rule 5.9). It compares a new differential to
//     the index in force BEFORE that round, which again needs index history.
//   - Playing Conditions Calculation — not observable from our data; any PCC is
//     already inside a CDGA-posted differential.
// So this is the uncapped, un-reduced WHS calculation. With no history to drift
// against, it matches the posted index whenever no cap/ESR is in force.

/** How many of the lowest differentials count, and the adjustment, by record size (WHS Rule 5.2). */
const WHS_TABLE: Record<number, { use: number; adjust: number }> = {
  3: { use: 1, adjust: -2.0 },
  4: { use: 1, adjust: -1.0 },
  5: { use: 1, adjust: 0 },
  6: { use: 2, adjust: -1.0 },
  7: { use: 2, adjust: 0 },
  8: { use: 2, adjust: 0 },
  9: { use: 3, adjust: 0 },
  10: { use: 3, adjust: 0 },
  11: { use: 3, adjust: 0 },
  12: { use: 4, adjust: 0 },
  13: { use: 4, adjust: 0 },
  14: { use: 4, adjust: 0 },
  15: { use: 5, adjust: 0 },
  16: { use: 5, adjust: 0 },
  17: { use: 6, adjust: 0 },
  18: { use: 6, adjust: 0 },
  19: { use: 7, adjust: 0 },
  20: { use: 8, adjust: 0 },
};

/** WHS minimum record size; below this there is no index, never a guessed one. */
export const HANDICAP_MIN_ROUNDS = 3;
/** The scoring record is the most recent 20 differentials. */
export const HANDICAP_RECORD_SIZE = 20;
/** WHS maximum Handicap Index. */
export const HANDICAP_MAX_INDEX = 54.0;

export type HandicapRound = {
  differential: number;
  /** YYYY-MM-DD — the recency key. ISO dates compare lexicographically. */
  playedDate: string;
  /** Test rounds are kept (D24) but never count toward the index. */
  isTest?: boolean;
};

export type HandicapIndexResult = {
  /** One decimal. Null below HANDICAP_MIN_ROUNDS — the UI shows "—", never a fake number. */
  index: number | null;
  /** Differentials in the scoring record (non-test, most recent ≤ 20). */
  roundsInRecord: number;
  /** How many of the lowest differentials were averaged (0 when index is null). */
  differentialsUsed: number;
};

/**
 * WHS Handicap Index from a list of rounds.
 *   1. drop test rounds;
 *   2. keep the 20 most recent by playedDate (ties keep the caller's order, so
 *      pass rounds newest-first by created_at for a stable tiebreak);
 *   3. average the lowest N per the WHS table, apply its adjustment;
 *   4. round to the nearest 0.1 and cap at 54.0.
 *
 * Arithmetic runs in integer tenths: differentials are defined to one decimal,
 * so this removes float drift from the rounding step (8.65 must round to 8.7,
 * and 8.6 + 8.7 in floating point does not average to exactly 8.65).
 */
export function computeHandicapIndex(rounds: readonly HandicapRound[]): HandicapIndexResult {
  const record = rounds
    .filter((r) => !r.isTest && Number.isFinite(r.differential))
    .map((r, i) => ({ r, i }))
    // Stable newest-first: date desc, then the caller's order.
    .sort((a, b) => b.r.playedDate.localeCompare(a.r.playedDate) || a.i - b.i)
    .slice(0, HANDICAP_RECORD_SIZE)
    .map(({ r }) => r.differential);

  const n = record.length;
  const rule = WHS_TABLE[n];
  if (n < HANDICAP_MIN_ROUNDS || !rule) {
    return { index: null, roundsInRecord: n, differentialsUsed: 0 };
  }

  const lowestTenths = record
    .map((d) => Math.round(d * 10))
    .sort((a, b) => a - b)
    .slice(0, rule.use);
  const avgTenths = lowestTenths.reduce((s, t) => s + t, 0) / rule.use;
  const tenths = roundHalfAwayFromZero(avgTenths + Math.round(rule.adjust * 10));
  // `+ 0` normalises a -0 (a scratch index from a negative average) to 0.
  const index = Math.min(tenths / 10 + 0, HANDICAP_MAX_INDEX);

  return { index, roundsInRecord: n, differentialsUsed: rule.use };
}

/** Conventional rounding (x.5 → away from zero), so a plus index rounds symmetrically. */
function roundHalfAwayFromZero(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}
