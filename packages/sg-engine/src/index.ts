// @gai/sg-engine — deterministic strokes-gained / dispersion / EV math.
//
// INVARIANT #1: the math runs here, in code. The LLM only narrates the numbers
// this package returns. Nothing here may do I/O or hit the network — no fetch,
// no fs, no db, no Date.now() in a decision path, no Math.random().
// Determinism is the contract; the invariant tests are the safety net.

/** Engine identity — used by the Phase 0 round-trip to prove the package wires in. */
export const SG_ENGINE_VERSION = "0.2.0" as const;

/**
 * Pure determinism probe. Same input -> same output, forever, zero side effects.
 * Phase 0 placeholder the invariants test exercises; the real SG math is predictHole.
 */
export function deterministicProbe(seed: number): number {
  // Pure arithmetic only. No randomness, no clock, no I/O.
  return (seed * 2654435761) % 2 ** 32;
}

// Phase 2B surface.
export { predictHole } from "./engine";
export { PERSONAS } from "./personas";
export { normalQuantile, probExceed } from "./stats";

// Phase 3C surface — the Broadie expected-strokes model.
export { expectedStrokesFromLie } from "./sgBaseline";
export { sampleDispersion } from "./sampler";
export { classifyLandingZone } from "./classifier";
export { computeExpectedStrokes } from "./expectedStrokes";
export type { Lie } from "./sgBaseline";
export type { DispersionSample } from "./sampler";
export type { LandingLie } from "./classifier";
export type {
  ConfidenceFlag,
  ClubDispersion,
  HoleFeature,
  HoleInput,
  PersonaRiskConfig,
  StrategyResult,
} from "./types";
