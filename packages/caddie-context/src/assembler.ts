// The five-layer context assembler — invariant #5 made concrete.
//
// This module does NO math (that is @gai/sg-engine) and NO I/O (no DB, no network,
// no secrets). It receives the hole, the engine's already-computed StrategyResult,
// a persona id, and the live conditions, and composes them into a single prompt
// string for the Anthropic call in Session 3B. Every number it emits comes from
// the hole or the result — it never invents a figure.

import type { HoleInput, HoleFeature, StrategyResult, PracticeSignal } from '@gai/sg-engine'
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

// =============================================================
// Phase 4.5 — the practice coach (D14). The SAME five-layer assembler, with a
// Layer-5 SWAP: where the yardage book puts this hole's SG output in Layer 5,
// the coach puts the engine's ranked practice signals. Layers 1, 3, 4 are
// unchanged (core rules + player profile + persona voice), so the coach speaks
// in the selected caddie's voice and inherits the profile's practice
// preferences. Layer 2 (course/hole) is OMITTED — there is no hole in front of
// the player on the range.
//
// INVARIANT #4 for the coach: the model never invents a drill title or a URL.
// The only drills + links it may cite are the ones passed in `availableDrills`,
// which come from the curated `drill` table. A NULL url stays description-only.
// =============================================================

/** Shape of a drill row as the coach prompt consumes it (a slice of the `drill` table). */
export type CoachDrill = {
  area: string
  title: string
  description: string
  resource_url: string | null
  resource_kind: string
}

/**
 * Builds the Layer 5 block for the practice coach — the ranked signals, verbatim
 * from the engine's `rankPracticeSignals`. Deliberately free of any hole/course
 * vocabulary (no yardage, carry target, or green): this is the swapped-in Layer 5
 * that replaces the yardage book's hole output, and the isolation test guards it.
 */
export function buildPracticeCoachLayer(signals: PracticeSignal[]): string {
  const body = signals.length
    ? signals
        .map(
          (s) => `- [P${s.priority}] area=${s.area} (${s.sourceSignal}): ${s.description}`,
        )
        .join('\n')
    : '- (no practice signals — the bag and the scoring data look clean right now)'

  return [
    'Ranked practice signals (computed by the engine — do NOT re-rank them and do NOT invent new ones):',
    body,
  ].join('\n')
}

/** One available-drill line. NULL url → explicitly marked link-less (never fabricate one). */
function describeDrill(d: CoachDrill): string {
  const link = d.resource_url
    ? ` [link (${d.resource_kind}): ${d.resource_url}]`
    : ` [${d.resource_kind} — no link available, describe it only]`
  return `- area=${d.area} | title="${d.title}" — ${d.description}${link}`
}

const PRACTICE_FOOTER = `You are the practice coach, speaking in the persona voice above. Produce EXACTLY three recommendations, highest-priority signal first.

Output ONLY three blocks in this exact format, nothing before or after:

[REC]
PRIORITY: <the signal's priority number>
AREA: <the signal's area>
SIGNAL: <the signal's sourceSignal, copied verbatim>
DRILL: <the exact title of one drill from the Available drills list>
WHY: <2–3 sentences in the persona voice, tying the work to the player's actual numbers from the signal>
[/REC]

Hard rules:
- Each recommendation must map to one of the ranked signals above, in priority order.
- DRILL must be copied EXACTLY from the Available drills list — never invent a drill title, and never write a URL of your own. If the chosen drill has no link, that is fine; just recommend it by title.
- The WHY cites the player's real figures from the signal; never fabricate a number.
- Respect the player's practice preferences from the profile: range-first, embed putting into a range session rather than isolating it, 1–2x per week, feel-based — no long structured putting blocks.
- No swing mechanics (Layer 1 still wins). Naming a drill is selection, not a swing cue.`

/**
 * Assembles the full practice-coach prompt: Layers 1, 3, 4 exactly as the
 * yardage book uses them, with the ranked practice signals swapped into Layer 5
 * and the curated drill list appended as the model's ONLY source of drills/links.
 * persona: one of 'beta' | 'rain_man' | 'captain_69' | 'the_ringer'.
 */
export function assemblePracticePrompt(
  signals: PracticeSignal[],
  persona: string,
  availableDrills: CoachDrill[],
): string {
  const voice = PERSONA_VOICES[persona]
  if (!voice) {
    throw new Error(
      `Unknown persona "${persona}". Expected one of: ${Object.keys(PERSONA_VOICES).join(', ')}.`,
    )
  }

  const drills = availableDrills.length
    ? availableDrills.map(describeDrill).join('\n')
    : '- (no drills available — recommend the work in plain terms, still no invented links)'

  return [
    '## LAYER 1 — CORE RULES',
    CORE_RULES,
    '',
    // LAYER 2 (course & hole) is intentionally omitted — the practice coach has no hole.
    '## LAYER 3 — PLAYER PROFILE',
    PLAYER_PROFILE,
    '',
    '## LAYER 4 — PERSONA VOICE',
    voice,
    '',
    '## LAYER 5 — PRACTICE SIGNALS',
    buildPracticeCoachLayer(signals),
    '',
    'Available drills (the ONLY drills and links you may cite — never invent a drill title or a URL):',
    drills,
    '',
    '---',
    PRACTICE_FOOTER,
  ].join('\n')
}

// =============================================================
// Phase 5 — the post-round caddie recap (D-5). The SAME five-layer assembler with
// another Layer-5 SWAP: where the yardage book puts this hole's SG output and the
// practice coach puts ranked signals, the recap puts the FINISHED round's scoring
// stats. Layers 1, 3, 4 are unchanged. Layer 2 (course/hole) is OMITTED — the
// round is over; there is no single hole in front of the player.
//
// INVARIANT #1: every figure below is computed in code (services/api summarizeRound
// / computeScoringWeaknesses). The recap NARRATES these numbers — it never recomputes
// a stat or invents a figure. INVARIANT #4: no URLs — this is plain prose.
// =============================================================

/** The round stat shape the recap prompt consumes (a slice of services/api RoundStats). */
export type RoundRecapStats = {
  courseName: string
  playedDate: string
  holesPlayed: number
  totalStrokes: number
  totalPar: number
  vsPar: number
  totalPutts: number | null
  fairwaysHit: number
  fairwaysPossible: number
  fairwayPct: number | null
  gir: number
  girPct: number | null
  scramblingPct: number | null
}

/** "+7" / "-1" / "E" — the conventional golf score-to-par label. */
function vsParLabel(vsPar: number): string {
  if (vsPar === 0) return 'E'
  return vsPar > 0 ? `+${vsPar}` : `${vsPar}`
}

/**
 * Builds the Layer 5 block for the round recap — the finished round's stats,
 * verbatim from the computed RoundStats + scoring weaknesses. Deliberately free of
 * any hole/course-strategy vocabulary (no carry target, no danger side): this is
 * the swapped-in Layer 5 that replaces the yardage book's hole output.
 */
export function buildRoundRecapLayer(
  stats: RoundRecapStats,
  weaknesses: Array<{ area: string; value: number; benchmark: number }>,
): string {
  const lines: string[] = [
    `Round just finished at ${stats.courseName} on ${stats.playedDate}.`,
    `Score: ${stats.totalStrokes} strokes over ${stats.holesPlayed} holes, ${vsParLabel(stats.vsPar)} to par (par ${stats.totalPar}).`,
  ]
  if (stats.totalPutts != null) lines.push(`Putts: ${stats.totalPutts}.`)
  if (stats.fairwaysPossible > 0) {
    lines.push(
      `Fairways hit: ${stats.fairwaysHit} of ${stats.fairwaysPossible}${stats.fairwayPct != null ? ` (${stats.fairwayPct}%)` : ''}.`,
    )
  }
  lines.push(
    `Greens in regulation: ${stats.gir} of ${stats.holesPlayed}${stats.girPct != null ? ` (${stats.girPct}%)` : ''}.`,
  )
  if (stats.scramblingPct != null) {
    lines.push(`Scrambling (up-and-down when missing the green): ${stats.scramblingPct}%.`)
  }

  const weak = weaknesses.length
    ? weaknesses
        .map((w) => `- ${w.area} is ${w.value} vs a ${w.benchmark} benchmark — outside the line`)
        .join('\n')
    : '- (no metric is meaningfully outside its benchmark this round)'

  return [
    'The round, by the numbers (computed by the app — narrate these, do NOT recompute or invent any figure):',
    lines.map((l) => `- ${l}`).join('\n'),
    '',
    'Flagged scoring weaknesses (the data leaks worth a practice session):',
    weak,
  ].join('\n')
}

const RECAP_FOOTER = `You are the caddie, speaking in the persona voice above. Give a SHORT post-round recap, three to five sentences total:
- One line on what went well (cite a real figure from above).
- One line on what the data says to work on (point at a flagged weakness, in the player's real numbers).
- One sentence of genuine encouragement to close.

Hard rules:
- Use ONLY the numbers above — never invent or recompute a figure.
- No swing mechanics (Layer 1 still wins). No drills, no URLs.
- Speak in the persona voice; keep it tight and human, not a stat dump.`

/**
 * Assembles the full round-recap prompt: Layers 1, 3, 4 exactly as the yardage book
 * uses them, with the finished round's stats swapped into Layer 5.
 * persona: one of 'beta' | 'rain_man' | 'captain_69' | 'the_ringer'.
 */
export function assembleRoundRecapPrompt(
  stats: RoundRecapStats,
  weaknesses: Array<{ area: string; value: number; benchmark: number }>,
  persona: string,
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
    // LAYER 2 (course & hole) is intentionally omitted — the round is over.
    '## LAYER 3 — PLAYER PROFILE',
    PLAYER_PROFILE,
    '',
    '## LAYER 4 — PERSONA VOICE',
    voice,
    '',
    '## LAYER 5 — ROUND RECAP',
    buildRoundRecapLayer(stats, weaknesses),
    '',
    '---',
    RECAP_FOOTER,
  ].join('\n')
}
