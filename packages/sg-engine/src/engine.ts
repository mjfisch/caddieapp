import type {
  ClubDispersion,
  ConfidenceFlag,
  HoleFeature,
  HoleInput,
  PersonaRiskConfig,
  StrategyResult,
} from './types'
import { normalQuantile } from './stats'

// =============================================================
// predictHole — the deterministic strategy call (invariant #1).
//
// Pure function: same (hole, dispersion, persona) -> same StrategyResult,
// forever. No I/O, no clock, no randomness. It receives numbers and returns a
// recommendation + terse factual `reasoning` lines; the Phase-3 LLM assembler
// narrates those facts. The model never computes here and never overrides the
// club/target this function picks.
// =============================================================

/** Hazards a club must physically carry. Ordered by how much they punish a miss. */
const HAZARD_KINDS = new Set<HoleFeature['kind']>(['water', 'ob', 'forced_carry'])
const DANGER_PRIORITY: Record<string, number> = { water: 3, ob: 2, bunker: 1 }
const LATERAL_SIDES = new Set<HoleFeature['side']>(['left', 'right', 'center'])

/** Confidence precedence — higher rank = more trustworthy. */
const CONFIDENCE_RANK: Record<ConfidenceFlag, number> = { seeded: 0, partial: 1, measured: 2 }

/** Lowest (least trustworthy) flag among the clubs that drove the recommendation. */
function lowestConfidence(flags: ConfidenceFlag[]): ConfidenceFlag {
  return flags.reduce((lo, f) => (CONFIDENCE_RANK[f] < CONFIDENCE_RANK[lo] ? f : lo))
}

const round = (n: number): number => Math.round(n)

type Scored = { d: ClubDispersion; eff: number }

/**
 * Club selection. Effective carry = carryMean × aggressionMultiplier. Pick the
 * club that covers the yardage with the smallest excess (ideally within ~15y);
 * if nothing reaches it, fall back to the longest club available. Deterministic:
 * ties resolve to the first club in array order (strict comparisons).
 */
function selectClub(scored: Scored[], yardage: number): Scored {
  const covering = scored.filter((s) => s.eff >= yardage)
  if (covering.length) {
    return covering.reduce((best, s) =>
      s.eff - yardage < best.eff - yardage ? s : best
    )
  }
  // Nothing covers the hole — take the longest club in the bag.
  return scored.reduce((best, s) => (s.eff > best.eff ? s : best))
}

export function predictHole(
  hole: HoleInput,
  dispersion: ClubDispersion[],
  persona: PersonaRiskConfig
): StrategyResult {
  if (dispersion.length === 0) {
    throw new Error('predictHole: dispersion is empty — no clubs to choose from')
  }

  const reasoning: string[] = []
  const considered: ConfidenceFlag[] = []
  const missPct = persona.missPercentile
  const missLabel = `p${round(missPct * 100)}`
  // Short-miss carry: the carry you'd fall short of `missPercentile` of the time.
  // Higher missPercentile -> lower quantile -> a more pessimistic (shorter) carry.
  const shortMissOf = (d: ClubDispersion) =>
    normalQuantile(d.carryMean, d.carrySD, 1 - missPct)

  // ── 1. Club selection ──────────────────────────────────────────────────────
  const scored: Scored[] = dispersion.map((d) => ({ d, eff: d.carryMean * persona.aggressionMultiplier }))
  const chosen = selectClub(scored, hole.yardageWhite)
  considered.push(chosen.d.confidence)
  const excess = round(chosen.eff - hole.yardageWhite)
  reasoning.push(
    `Carry target ${hole.yardageWhite}. ${chosen.d.club} plays ${round(chosen.eff)} (×${persona.aggressionMultiplier})${
      excess >= 0 ? `, +${excess} over` : `, ${excess} short of cover`
    }.`
  )

  // ── 2. Hazard check ─────────────────────────────────────────────────────────
  // Any water / ob / forced_carry with a real carryToClear the club must clear.
  const carryHazards = hole.features.filter(
    (f) => HAZARD_KINDS.has(f.kind) && f.carryToClear != null
  )
  const chosenShortMiss = shortMissOf(chosen.d)
  // The binding hazard is the hardest one to clear (largest carryToClear).
  let bindingHazard: HoleFeature | null = null
  for (const h of carryHazards) {
    if (chosenShortMiss < (h.carryToClear as number)) {
      if (!bindingHazard || (h.carryToClear as number) > (bindingHazard.carryToClear as number)) {
        bindingHazard = h
      }
    }
  }
  const hazardFails = bindingHazard !== null

  // ── 3. Layup logic ──────────────────────────────────────────────────────────
  let recommendedClub = chosen.d.club
  let carryTarget = round(chosen.d.carryMean)
  let layupRecommended = false

  if (hazardFails) {
    const clear = bindingHazard!.carryToClear as number
    reasoning.push(
      `${bindingHazard!.kind} carry-to-clear ${clear}. ${chosen.d.club} short-miss (${missLabel}) = ${round(
        chosenShortMiss
      )} — short.`
    )
    if (persona.layupBias >= 0) {
      // Lay up: the longest club whose short-miss lands >= 10y short of the hazard.
      const safeBar = clear - 10
      const safe = scored.filter((s) => shortMissOf(s.d) <= safeBar)
      const layup = safe.length
        ? safe.reduce((best, s) => (s.d.carryMean > best.d.carryMean ? s : best))
        : // Nothing is short enough — take the shortest club to minimize the miss.
          scored.reduce((best, s) => (s.d.carryMean < best.d.carryMean ? s : best))
      layupRecommended = true
      recommendedClub = layup.d.club
      carryTarget = round(layup.d.carryMean)
      considered.push(layup.d.confidence)
      reasoning.push(
        `Layup: ${layup.d.club} short-miss ${round(shortMissOf(layup.d))} stays short of ${clear}.`
      )
    } else {
      // Aggressive persona: name the risk, don't force the layup.
      reasoning.push(`${persona.name} goes for it — ${bindingHazard!.kind} ${clear} not safely cleared.`)
    }
  } else if (carryHazards.length) {
    const clear = Math.max(...carryHazards.map((h) => h.carryToClear as number))
    reasoning.push(
      `Carry hazards clear: ${chosen.d.club} short-miss (${missLabel}) = ${round(chosenShortMiss)} >= ${clear}.`
    )
  }

  // ── 4. Danger side ──────────────────────────────────────────────────────────
  // Most penalizing feature with a lateral side (water > ob > bunker; ties keep
  // array order). front/back features carry no lateral danger side.
  let dangerSide: StrategyResult['dangerSide'] = null
  let bestPriority = 0
  for (const f of hole.features) {
    const pr = DANGER_PRIORITY[f.kind]
    if (pr && LATERAL_SIDES.has(f.side) && pr > bestPriority) {
      bestPriority = pr
      dangerSide = f.side as StrategyResult['dangerSide']
    }
  }
  if (dangerSide) {
    const kind = hole.features.find((f) => f.side === dangerSide && DANGER_PRIORITY[f.kind] === bestPriority)?.kind
    reasoning.push(`${dangerSide} is ${kind ?? 'trouble'} — favor away.`)
  }

  // ── 5. Expected strokes (placeholder; full Broadie model in Phase 3) ─────────
  let expectedStrokes = hole.par
  if (hole.strokeIndex > 9) expectedStrokes += 0.1 * (hole.strokeIndex - 9)
  else if (hole.strokeIndex < 9) expectedStrokes -= 0.05 * (9 - hole.strokeIndex)
  expectedStrokes = Math.round(expectedStrokes * 100) / 100

  // ── 6. Confidence flag — invariant #2: lowest among the clubs we leaned on ───
  const confidenceFlag = lowestConfidence(considered)

  // Keep reasoning terse (2-4 facts for the assembler).
  return {
    recommendedClub,
    carryTarget,
    dangerSide,
    layupRecommended,
    expectedStrokes,
    confidenceFlag,
    reasoning: reasoning.slice(0, 4),
  }
}
