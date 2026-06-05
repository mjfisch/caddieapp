import type { PersonaRiskConfig } from './types'

// INVARIANT #6: the four personas are voice × risk-config, and the risk-config
// numbers are LOCKED. Do not rename a key, do not touch a number, without a
// decision-log entry in docs/DECISIONS.md. A voice-only swap must leave the
// target identical (CI test); a risk-config swap must move it in the expected
// direction. These three knobs are the only levers risk gets:
//
//   missPercentile       — how pessimistic the short-miss estimate is. HIGHER =
//                          more conservative (assumes a bigger short miss).
//   layupBias            — willingness to lay up. >= 0 lays up when a hazard is
//                          not safely cleared; < 0 flags the risk but goes for it.
//   aggressionMultiplier — how much carry the persona trusts. < 1 clubs up,
//                          > 1 clubs down and commits.
export const PERSONAS: Record<string, PersonaRiskConfig> = {
  beta: {
    name: 'Beta',
    missPercentile: 0.85,
    layupBias: 0.3,
    aggressionMultiplier: 0.8,
  },
  rain_man: {
    name: 'Rain Man',
    missPercentile: 0.75,
    layupBias: 0.1,
    aggressionMultiplier: 1.0,
  },
  captain_69: {
    name: 'Captain 69',
    missPercentile: 0.65,
    layupBias: -0.1,
    aggressionMultiplier: 1.15,
  },
  the_ringer: {
    name: 'The Ringer',
    missPercentile: 0.55,
    layupBias: -0.2,
    aggressionMultiplier: 1.3,
  },
}
