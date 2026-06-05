// Landing-zone classifier — maps a sampled (carry, lateral) point to a lie.
//
// Pure, deterministic, no I/O. Given where a shot actually finished (carry +
// lateral displacement) and the hole's features, decide the lie the SG baseline
// then prices. Rules are applied in the order documented below; the first match
// wins. No polygon geometry (the v2 pivot removed it) — features carry simple
// distance / carry-to-clear scalars and we reason about them directly.

import type { HoleInput } from './types'

export type LandingLie = 'fairway' | 'rough' | 'bunker' | 'penalty' | 'green'

// Lateral half-width (yards) of a water hazard's danger zone, either side of
// centre. OB is treated as unbounded laterally (a wide miss is still OB).
const WATER_LATERAL_HALF = 30

/**
 * Classify a shot's landing lie from its carry / lateral displacement, the hole
 * features, and the intended carry target. Rules, in priority order:
 *
 *  1. fairway — carry within 10 yd of target AND lateral within 15 yd.
 *  2. penalty — a water/ob feature with a carryToClear the shot fell short of,
 *               and (for water) a lateral miss inside the hazard's zone.
 *  3. bunker  — a bunker feature whose distanceFromTee the carry reached
 *               (±10 yd) with lateral within 20 yd.
 *  4. green   — carry just past the hole yardage (< 5 yd long) and lateral ≤ 20.
 *  5. rough   — everything else.
 */
export function classifyLandingZone(
  carry: number,
  lateral: number,
  hole: HoleInput,
  targetCarry: number
): LandingLie {
  // 1. On line and on length → fairway (the intended landing area).
  if (Math.abs(carry - targetCarry) <= 10 && Math.abs(lateral) <= 15) {
    return 'fairway'
  }

  // 2. Penalty — failed to carry a water/ob hazard while inside its lateral zone.
  for (const f of hole.features) {
    if ((f.kind === 'water' || f.kind === 'ob') && f.carryToClear != null) {
      if (carry < f.carryToClear) {
        const inLateralZone =
          f.kind === 'ob' ? true : Math.abs(lateral) <= WATER_LATERAL_HALF
        if (inLateralZone) return 'penalty'
      }
    }
  }

  // 3. Bunker — carry reached a bunker's distance band with a moderate lateral miss.
  for (const f of hole.features) {
    if (f.kind === 'bunker' && f.distanceFromTee != null) {
      if (Math.abs(carry - f.distanceFromTee) <= 10 && Math.abs(lateral) <= 20) {
        return 'bunker'
      }
    }
  }

  // 4. Green — flew the hole yardage by a hair, still on line.
  if (carry > hole.yardageWhite && carry - hole.yardageWhite < 5 && Math.abs(lateral) <= 20) {
    return 'green'
  }

  // 5. Everything else lands in the rough.
  return 'rough'
}
