// @gai/sg-engine — public type surface for the deterministic strategy engine.
//
// INVARIANT #1: these are the shapes the LLM narrates; it never computes them.
// INVARIANT #2: `ConfidenceFlag` rides every dispersion row and survives into the
// StrategyResult, so the caddie's certainty can never outrun the data.

/** Data-quality flag for a club's dispersion — invariant #2. measured > partial > seeded. */
export type ConfidenceFlag = 'measured' | 'partial' | 'seeded'

/** One club's measured (or seeded) shot dispersion. All distances in yards. */
export type ClubDispersion = {
  club: string
  carryMean: number
  carrySD: number
  lateralSD: number
  confidence: ConfidenceFlag
}

/** A single strategic feature on a hole (hazard, complex, forced carry). */
export type HoleFeature = {
  kind: 'bunker' | 'water' | 'ob' | 'tree_line' | 'forced_carry' | 'green_complex'
  side: 'left' | 'right' | 'center' | 'front' | 'back'
  distanceFromTee: number | null
  carryToClear: number | null
}

/** The hole as the engine sees it — yardage + the features that shape the call. */
export type HoleInput = {
  number: number
  par: number
  strokeIndex: number
  yardageWhite: number
  features: HoleFeature[]
}

/** Persona = voice × risk-config; this is the risk-config half (invariant #6, locked). */
export type PersonaRiskConfig = {
  name: string
  missPercentile: number
  layupBias: number
  aggressionMultiplier: number
}

/** The engine's verdict for one hole. Deterministic for identical inputs. */
export type StrategyResult = {
  recommendedClub: string
  carryTarget: number
  dangerSide: 'left' | 'right' | 'center' | null
  layupRecommended: boolean
  expectedStrokes: number
  confidenceFlag: ConfidenceFlag
  reasoning: string[]
}
