// The five context layers, in strict precedence order — invariant #5.
//
// Layer 1 (core rules / accuracy) wins: no lower layer may invent a number,
// override the engine's club/target, or recommend a clear loser. This array is
// the single source of truth for the assembler's section order and is mirrored
// by @gai/shared's CONTEXT_LAYERS (the invariant test asserts they stay equal,
// which is what guards the two against drift).
//
// Relocked from the original accuracy/core/profile/persona/situation vocabulary
// to these assembler-section names — see docs/DECISIONS.md "D-3A-1".
export const LAYER_ORDER = [
  'core_rules',     // Layer 1 — hard constraints the caddie never violates.
  'course_hole',    // Layer 2 — hole data + the engine's StrategyResult (the numbers).
  'player_profile', // Layer 3 — Michael's tendencies and hard behavioral rules.
  'persona_voice',  // Layer 4 — the selected persona's voice (tone only, no risk numbers).
  'live_input',     // Layer 5 — the live ask: conditions, pin, wind, lie, notes.
] as const

export type LayerName = typeof LAYER_ORDER[number]
