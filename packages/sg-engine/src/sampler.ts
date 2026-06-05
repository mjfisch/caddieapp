// Dispersion ellipse sampler — deterministic, seeded (invariant #1).
//
// Math.random() is BANNED in this package: the engine must give the same answer
// for the same inputs, forever. We sample a 2-D normal dispersion (carry × lateral)
// with a hand-rolled linear congruential generator (Numerical Recipes constants)
// turned into normals via Box–Muller. No external libraries, no clock, no entropy.

const FIXED_SEED = 'gai-caddie-deterministic'

// 32-bit LCG (Numerical Recipes): state -> (a*state + c) mod 2^32.
const LCG_A = 1664525
const LCG_C = 1013904223
const LCG_M = 2 ** 32

/** Fold a string into a 32-bit unsigned seed (deterministic char-code mix). */
function seedFromString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) % LCG_M
  }
  return h
}

/** A closure yielding the next uniform in (0, 1) from the LCG state. */
function makeUniform(seed: number): () => number {
  let state = seed % LCG_M
  return () => {
    state = (LCG_A * state + LCG_C) % LCG_M
    // Map to (0,1); nudge off the exact 0 endpoint so Math.log stays finite.
    return (state + 0.5) / LCG_M
  }
}

export type DispersionSample = { carry: number; lateral: number }

/**
 * Samples `n` points from a 2-D normal dispersion around the intended target.
 * carryMean / carrySD describe the short–long axis; lateralSD the left–right axis
 * (lateral mean is 0 — the target is the aim point). Always seeded with the fixed
 * string, so identical inputs always return an identical array.
 */
export function sampleDispersion(
  carryMean: number,
  carrySD: number,
  lateralSD: number,
  n: number = 500
): DispersionSample[] {
  const nextUniform = makeUniform(seedFromString(FIXED_SEED))
  const out: DispersionSample[] = []
  for (let i = 0; i < n; i++) {
    // Box–Muller: two uniforms -> two independent standard normals.
    const u1 = nextUniform()
    const u2 = nextUniform()
    const r = Math.sqrt(-2 * Math.log(u1))
    const theta = 2 * Math.PI * u2
    const z0 = r * Math.cos(theta)
    const z1 = r * Math.sin(theta)
    out.push({
      carry: carryMean + carrySD * z0,
      lateral: lateralSD * z1,
    })
  }
  return out
}
