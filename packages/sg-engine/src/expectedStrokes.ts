// Expected-strokes calculator — the Broadie predictor core (invariant #1).
//
// Pure, deterministic, no I/O. For a club/target choice on a hole, sample the
// dispersion ellipse, classify each landing point's lie, price it against the
// strokes-gained baseline, and average. The mean is the expected strokes to hole
// out for that club/target — the number the caddie compares and the LLM narrates.

import type { ClubDispersion, HoleInput } from './types'
import { sampleDispersion } from './sampler'
import { classifyLandingZone } from './classifier'
import { expectedStrokesFromLie } from './sgBaseline'

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Expected strokes for hitting `club` at `targetCarry` on `hole`.
 *
 * 1. Sample the club's dispersion ellipse (seeded, deterministic).
 * 2. Classify each sample's landing lie.
 * 3. The remaining distance to the pin is |targetCarry − carry|.
 * 4. Price the lie+distance against the SG baseline.
 * 5. Add 1 for the shot just taken. The penalty stroke for a hazard lie is
 *    already baked into the `penalty` baseline (it is defined as "+1 stroke +
 *    drop-spot value" in handicap_dispersion_seed.md), so it is NOT added again
 *    here — doing so would double-count it.
 * 6. Return the mean across all samples, rounded to 2 decimal places.
 */
export function computeExpectedStrokes(
  hole: HoleInput,
  club: ClubDispersion,
  targetCarry: number,
  nSamples: number = 500
): number {
  const samples = sampleDispersion(club.carryMean, club.carrySD, club.lateralSD, nSamples)

  let total = 0
  for (const s of samples) {
    const lie = classifyLandingZone(s.carry, s.lateral, hole, targetCarry)
    const remaining = Math.abs(targetCarry - s.carry)
    total += 1 + expectedStrokesFromLie(remaining, lie)
  }

  return round2(total / samples.length)
}
