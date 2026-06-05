// The five-layer context assembler — invariant #5 made concrete.
//
// This module does NO math (that is @gai/sg-engine) and NO I/O (no DB, no network,
// no secrets). It receives the hole, the engine's already-computed StrategyResult,
// a persona id, and the live conditions, and composes them into a single prompt
// string for the Anthropic call in Session 3B. Every number it emits comes from
// the hole or the result — it never invents a figure.

import type { HoleInput, HoleFeature, StrategyResult } from '@gai/sg-engine'
import { CORE_RULES, PLAYER_PROFILE, PERSONA_VOICES } from './static'

/** Confidence framing for Layer 2 — keeps the caddie's certainty on the data flag
 *  (invariant #2). The `measured` line is deliberately free of hedge words
 *  ("estimate"/"approximately"/"around"); the `seeded` line names the placeholder. */
const CONFIDENCE_FRAMING: Record<StrategyResult['confidenceFlag'], string> = {
  measured:
    'Data confidence: MEASURED — these are real, measured numbers. Speak decisively.',
  partial:
    'Data confidence: PARTIAL — only a small sample stands behind these numbers. Hedge lightly and note the thin sample.',
  seeded:
    'Data confidence: SEEDED — this club is a handicap-benchmark placeholder until it is mapped. Name it as a seeded placeholder; do not speak with false certainty.',
}

/** One hole feature as a single readable bullet. Only emits numbers it is given. */
function describeFeature(f: HoleFeature): string {
  const where = f.distanceFromTee != null ? ` at ${f.distanceFromTee} yds from the tee` : ''
  const carry = f.carryToClear != null ? `, carry ${f.carryToClear} yds to clear` : ''
  return `- ${f.kind} on the ${f.side}${where}${carry}`
}

/** Builds the Layer 2 block from hole data + engine output. */
export function buildCourseHoleLayer(
  hole: HoleInput,
  result: StrategyResult,
  courseName: string,
  teeSet: string,
): string {
  const features = hole.features.length
    ? hole.features.map(describeFeature).join('\n')
    : '- (no mapped hazards on this hole)'

  const reasoning = result.reasoning.length
    ? result.reasoning.map((r) => `- ${r}`).join('\n')
    : '- (engine returned no reasoning notes)'

  return [
    `Course: ${courseName} — ${teeSet} tees.`,
    `Hole ${hole.number}: par ${hole.par}, stroke index ${hole.strokeIndex}, ${hole.yardageWhite} yds.`,
    '',
    'Hole features:',
    features,
    '',
    'Engine recommendation (already shaped by the persona risk profile — do not override):',
    `- Club: ${result.recommendedClub}`,
    `- Carry target: ${result.carryTarget} yds`,
    `- Danger side: ${result.dangerSide ?? 'none flagged'}`,
    `- Lay up: ${result.layupRecommended ? 'yes' : 'no'}`,
    `- Expected strokes: ${result.expectedStrokes}`,
    `- Confidence flag: ${result.confidenceFlag}`,
    CONFIDENCE_FRAMING[result.confidenceFlag],
    '',
    'Engine reasoning:',
    reasoning,
  ].join('\n')
}

/** Builds the Layer 5 block from live conditions. */
export function buildLiveInputLayer(conditions: {
  windMph?: number
  windDir?: string
  pinPosition?: 'front' | 'middle' | 'back'
  lie?: string
  notes?: string
}): string {
  const lines: string[] = []

  if (conditions.windMph != null && conditions.windDir) {
    lines.push(`- Wind: ${conditions.windMph} mph, ${conditions.windDir}`)
  } else if (conditions.windMph != null) {
    lines.push(`- Wind: ${conditions.windMph} mph`)
  } else if (conditions.windDir) {
    lines.push(`- Wind: ${conditions.windDir}`)
  }
  if (conditions.pinPosition) lines.push(`- Pin: ${conditions.pinPosition}`)
  if (conditions.lie) lines.push(`- Lie: ${conditions.lie}`)
  if (conditions.notes) lines.push(`- Notes: ${conditions.notes}`)

  const body = lines.length ? lines.join('\n') : '- (no live conditions provided)'
  return ['The shot in front of the player right now:', body].join('\n')
}

const FOOTER =
  'You are the caddie. Respond in the persona voice above. Use only the numbers provided — never invent a yardage. Give the club call, the carry target, and your read in three to five sentences. No swing mechanics.'

/**
 * Assembles all five layers into the final prompt string, in strict precedence
 * order with clear `## LAYER` headers so the model can parse the boundaries.
 * persona: one of 'beta' | 'rain_man' | 'captain_69' | 'the_ringer'.
 */
export function assemblePrompt(
  hole: HoleInput,
  result: StrategyResult,
  persona: string,
  courseName: string,
  teeSet: string,
  conditions: Parameters<typeof buildLiveInputLayer>[0],
): string {
  const voice = PERSONA_VOICES[persona]
  if (!voice) {
    throw new Error(
      `Unknown persona "${persona}". Expected one of: ${Object.keys(PERSONA_VOICES).join(', ')}.`,
    )
  }

  return [
    '## LAYER 1 — CORE RULES',
    CORE_RULES,
    '',
    '## LAYER 2 — COURSE & HOLE',
    buildCourseHoleLayer(hole, result, courseName, teeSet),
    '',
    '## LAYER 3 — PLAYER PROFILE',
    PLAYER_PROFILE,
    '',
    '## LAYER 4 — PERSONA VOICE',
    voice,
    '',
    '## LAYER 5 — LIVE INPUT',
    buildLiveInputLayer(conditions),
    '',
    '---',
    FOOTER,
  ].join('\n')
}
