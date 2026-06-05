// @gai/caddie-context — the five-layer assembler, tone library, personas.
//
// INVARIANT #5: the five layers compose in precedence order; Layer 1 (accuracy) wins.
// INVARIANT #6: personas are voice x risk-config, and they're locked.
// This package assembles context for the LLM — it NEVER does math (that's @gai/sg-engine)
// and NEVER lets a persona voice override a number or recommend a clear loser.

export { LAYER_ORDER, type LayerName } from './layers'
export { CORE_RULES, PLAYER_PROFILE, PERSONA_VOICES } from './static'
export { assemblePrompt, buildCourseHoleLayer, buildLiveInputLayer } from './assembler'
export {
  assemblePracticePrompt,
  buildPracticeCoachLayer,
  type CoachDrill,
} from './assembler'
export {
  assembleRoundRecapPrompt,
  buildRoundRecapLayer,
  type RoundRecapStats,
} from './assembler'
