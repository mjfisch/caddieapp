// Strokes-gained baseline — Broadie expected-strokes-to-hole-out (invariant #1).
//
// Pure arithmetic, no libraries, no I/O. Every number below is sourced from the
// anchor table in `handicap_dispersion_seed.md` (Broadie *Every Shot Counts* /
// USGA grid). We do NOT invent baseline values: the fairway and green curves are
// real anchors, and the rough / bunker / penalty lies are modelled as the
// documented additive offsets over fairway at the same distance:
//
//   rough   ≈ fairway + 0.17   (seed: "Rough, 150 → 3.15, ≈ +0.17 vs fairway")
//   bunker  ≈ fairway + 0.33   (seed: "Sand, 50 → 2.95"; fairway(50) ≈ 2.62 → +0.33)
//   penalty ≈ fairway + 1.00   (seed: "Penalty | +1 stroke + the value of the drop spot",
//                               the drop spot valued at the fairway baseline)
//
// Modelling the harder lies as a constant offset over fairway is the same shape
// the seed itself uses for rough, and it guarantees the monotonic ordering
// fairway < rough < bunker < penalty at every distance.

export type Lie = 'tee' | 'fairway' | 'rough' | 'bunker' | 'green' | 'penalty'

/** [distanceYards, expectedStrokes] anchor points, ascending in distance. */
type Anchor = [number, number]

// Fairway anchors (yards → strokes), straight from the seed table.
const FAIRWAY_ANCHORS: Anchor[] = [
  [100, 2.8],
  [150, 2.98],
]

// Green anchors. The seed gives putting distances in feet (8 ft → 1.50,
// 20 ft → 1.87); converted to yards (÷3) so the whole table speaks one unit.
const GREEN_ANCHORS: Anchor[] = [
  [8 / 3, 1.5], // ~2.67 yd
  [20 / 3, 1.87], // ~6.67 yd
]

// Tee baseline — the seed gives a single anchor (par-4 ~400 → 3.99). With one
// point there is nothing to interpolate; the lie is never produced by the
// landing-zone classifier, so it exists only for completeness of the surface.
const TEE_ANCHORS: Anchor[] = [[400, 3.99]]

// Additive offsets over the fairway baseline at the same distance.
const LIE_OFFSET: Record<'fairway' | 'rough' | 'bunker' | 'penalty', number> = {
  fairway: 0,
  rough: 0.17,
  bunker: 0.33,
  penalty: 1.0,
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Linear interpolation across a sorted anchor table. Inside the range we
 * interpolate between the bracketing anchors; outside it we extrapolate linearly
 * from the two nearest anchors. A single-anchor table returns that anchor's value.
 */
function interpolate(anchors: Anchor[], x: number): number {
  if (anchors.length === 1) return anchors[0]![1]

  // Below the table: extrapolate from the first two anchors.
  if (x <= anchors[0]![0]) {
    const [x0, y0] = anchors[0]!
    const [x1, y1] = anchors[1]!
    return y0 + ((y1 - y0) / (x1 - x0)) * (x - x0)
  }
  // Above the table: extrapolate from the last two anchors.
  const last = anchors.length - 1
  if (x >= anchors[last]![0]) {
    const [x0, y0] = anchors[last - 1]!
    const [x1, y1] = anchors[last]!
    return y0 + ((y1 - y0) / (x1 - x0)) * (x - x0)
  }
  // Inside: find the bracketing pair and interpolate.
  for (let i = 0; i < last; i++) {
    const [x0, y0] = anchors[i]!
    const [x1, y1] = anchors[i + 1]!
    if (x >= x0 && x <= x1) {
      return y0 + ((y1 - y0) / (x1 - x0)) * (x - x0)
    }
  }
  // Unreachable given the guards above; satisfies the type checker.
  return anchors[last]![1]
}

/**
 * Expected strokes to hole out from a given distance (yards) and lie. Values are
 * sourced from the Broadie/USGA anchors in handicap_dispersion_seed.md; harder
 * lies are the documented additive offset over the fairway baseline. Rounded to
 * 2 decimal places.
 */
export function expectedStrokesFromLie(distanceYards: number, lie: Lie): number {
  if (lie === 'green') return round2(interpolate(GREEN_ANCHORS, distanceYards))
  if (lie === 'tee') return round2(interpolate(TEE_ANCHORS, distanceYards))
  const base = interpolate(FAIRWAY_ANCHORS, distanceYards)
  return round2(base + LIE_OFFSET[lie])
}
