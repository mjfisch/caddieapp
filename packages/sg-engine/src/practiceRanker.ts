// @gai/sg-engine — practice signal ranker (Phase 4.5, D14).
//
// INVARIANT #1 made concrete for the practice coach: the RANKING runs here, in
// pure code. The LLM only narrates + selects from what this returns — it never
// decides what to work on. Same input → same output, always: no I/O, no network,
// no LLM, no clock, no randomness. The invariant tests guard this alongside the
// rest of the engine.
//
// The ranker turns the player's current state (dispersion flags, feel-trust,
// scoring weaknesses) into a small, ordered list of practice signals. The order
// is the priority; the coach's Layer-5 swap consumes it verbatim.

/** One ranked practice signal. `priority` is 1-based, 1 = highest. */
export type PracticeSignal = {
  priority: number // 1 = highest
  area: string // coachable area, e.g. 'driver', 'lag_putting', '4i_path'
  sourceSignal: string // human-readable trigger: 'driver.confidence=partial'
  description: string // terse fact: 'Driver is partial — largest data gap in the bag'
}

export type RankerInput = {
  clubDispersion: Array<{ club: string; confidence: string; lateralSD: number; carrySD: number }>
  clubConfidence: Array<{ club: string; feelLevel: number | null }>
  scoringWeaknesses: Array<{ area: string; value: number; benchmark: number }>
}

/** Wider than this many yards of lateral spread is a directional problem (rule 3). */
const LATERAL_SD_BAR = 15
/** Feel 1–2 (of 4) is low trust (rule 4). */
const LOW_FEEL_BAR = 2
/** A scoring weakness only counts when it overshoots its benchmark by 30%+ (rule 5). */
const SCORING_GAP_MULTIPLIER = 1.3
/** Never overwhelm the coach — the top few signals only. */
const MAX_SIGNALS = 5

/**
 * Map a club id onto the coachable-area vocabulary the drill library uses
 * (driver / 4i_path / …). Documented special cases only; everything else keeps
 * its own club id so the coach can still match it to a drill by closeness.
 */
function clubToArea(club: string): string {
  if (club === 'driver') return 'driver'
  if (club === '4i' || club === '3h') return '4i_path'
  return club
}

/**
 * Map a scoring-weakness kind onto a coachable area. The detonator chain
 * (player profile) makes the mapping concrete: three-putts are a lag-speed
 * problem, doubles ignite on the tee. Unknown kinds pass through unchanged.
 */
function scoringToArea(kind: string): string {
  switch (kind) {
    case 'three_putt_pct':
      return 'lag_putting'
    case 'doubles_per_round':
      return 'driver'
    case 'scrambling_pct':
      return 'chipping'
    case 'par4_avg':
    case 'par_4_average':
      return 'driver'
    default:
      return kind
  }
}

/**
 * Rank the player's practice signals. Rules apply in strict priority order
 * (seeded > partial > directional > low-feel > scoring gap); the first signal to
 * claim an area wins, so each area appears at most once. Returns at most
 * MAX_SIGNALS, ordered highest-priority first, with `priority` renumbered 1..N.
 *
 * Pure and deterministic: iterates the inputs in their given order and never
 * touches the clock, randomness, or any I/O.
 */
export function rankPracticeSignals(input: RankerInput): PracticeSignal[] {
  // Build candidates in rule order. Each carries its coachable area; dedup keeps
  // the first (highest-priority) candidate per area.
  const candidates: Omit<PracticeSignal, 'priority'>[] = []

  // Rule 1 — seeded clubs: the engine is guessing on these. Highest priority.
  for (const c of input.clubDispersion) {
    if (c.confidence === 'seeded') {
      candidates.push({
        area: clubToArea(c.club),
        sourceSignal: `${c.club}.confidence=seeded`,
        description: `${c.club} dispersion is seeded — a handicap-benchmark placeholder the engine is guessing on, the biggest data gap in the bag`,
      })
    }
  }

  // Rule 2 — partial clubs: a thin real sample.
  for (const c of input.clubDispersion) {
    if (c.confidence === 'partial') {
      candidates.push({
        area: clubToArea(c.club),
        sourceSignal: `${c.club}.confidence=partial`,
        description: `${c.club} dispersion is partial — only a small sample stands behind the numbers, so the engine is half-guessing`,
      })
    }
  }

  // Rule 3 — directional problem: lateral spread past the bar.
  for (const c of input.clubDispersion) {
    if (c.lateralSD > LATERAL_SD_BAR) {
      const sd = Math.round(c.lateralSD * 10) / 10 // 1-decimal for a clean fact
      candidates.push({
        area: clubToArea(c.club),
        sourceSignal: `${c.club}.lateralSD=${sd}`,
        description: `${c.club} lateral spread is ${sd} yds — past the ${LATERAL_SD_BAR}-yd bar, a directional problem the book has to plan around`,
      })
    }
  }

  // Rule 4 — low feel-trust: a club you've been fighting (feel 1–2 of 4).
  for (const c of input.clubConfidence) {
    if (c.feelLevel != null && c.feelLevel <= LOW_FEEL_BAR) {
      candidates.push({
        area: clubToArea(c.club),
        sourceSignal: `${c.club}.feel=${c.feelLevel}`,
        description: `${c.club} feel-trust is low (${c.feelLevel} of 4) — you've flagged it as a club you're not trusting right now`,
      })
    }
  }

  // Rule 5 — scoring weakness past its benchmark by the gap multiplier.
  for (const w of input.scoringWeaknesses) {
    if (w.value > w.benchmark * SCORING_GAP_MULTIPLIER) {
      candidates.push({
        area: scoringToArea(w.area),
        sourceSignal: `${w.area}=${w.value}`,
        description: `${w.area} is ${w.value} vs a ${w.benchmark} benchmark — a meaningful scoring gap worth a session`,
      })
    }
  }

  // Dedup by area, first occurrence (highest priority) wins, then cap and number.
  const seen = new Set<string>()
  const ranked: PracticeSignal[] = []
  for (const cand of candidates) {
    if (seen.has(cand.area)) continue
    seen.add(cand.area)
    ranked.push({ priority: ranked.length + 1, ...cand })
    if (ranked.length >= MAX_SIGNALS) break
  }
  return ranked
}
