// @gai/sg-engine — deterministic strokes-gained / dispersion / EV math.
//
// INVARIANT #1: the math runs here, in code. The LLM only narrates the numbers
// this package returns. Nothing here may do I/O or hit the network — no fetch,
// no fs, no db, no Date.now() in a decision path, no Math.random().
// Determinism is the contract; the invariant tests are the safety net.

/** Engine identity — used by the Phase 0 round-trip to prove the package wires in. */
export const SG_ENGINE_VERSION = "0.0.0" as const;

/**
 * Pure determinism probe. Same input -> same output, forever, zero side effects.
 * Phase 0 placeholder the invariants test exercises; real SG math lands in Phase 2.
 */
export function deterministicProbe(seed: number): number {
  // Pure arithmetic only. No randomness, no clock, no I/O.
  return (seed * 2654435761) % 2 ** 32;
}

// Phase 2 surface (not yet implemented — signature reserved so callers can be typed):
// export function predictHole(hole: Hole, dispersion: Dispersion, persona: Persona): HolePlan;
