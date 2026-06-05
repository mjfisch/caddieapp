// Normal-distribution helpers — pure arithmetic, no libraries (invariant #1).
//
// The inverse CDF uses the Abramowitz & Stegun rational approximation (26.2.23),
// |error| < 4.5e-4 in the quantile. The CDF (for probExceed) uses the A&S 7.1.26
// rational approximation of erf, |error| < 1.5e-7. Both are deterministic: no
// clock, no randomness.

/**
 * Standard-normal quantile z such that P(Z <= z) = p, via A&S 26.2.23.
 * Defined for 0 < p < 1; clamps the open endpoints to a finite z.
 */
function standardNormalQuantile(p: number): number {
  if (p <= 0) return -Infinity
  if (p >= 1) return Infinity

  // A&S 26.2.23 approximates the upper tail for 0 < q <= 0.5 and returns a
  // positive z; we mirror it around the median for the lower half.
  const lower = p < 0.5
  const q = lower ? p : 1 - p
  const t = Math.sqrt(-2 * Math.log(q))

  const c0 = 2.515517
  const c1 = 0.802853
  const c2 = 0.010328
  const d1 = 1.432788
  const d2 = 0.189269
  const d3 = 0.001308

  const num = c0 + c1 * t + c2 * t * t
  const den = 1 + d1 * t + d2 * t * t + d3 * t * t * t
  const z = t - num / den

  return lower ? -z : z
}

/**
 * Returns the carry value at the given percentile of a normal distribution with
 * the provided mean and SD. Used to find a club's short-miss carry at a persona's
 * miss percentile when checking whether it clears a hazard.
 */
export function normalQuantile(mean: number, sd: number, percentile: number): number {
  return mean + sd * standardNormalQuantile(percentile)
}

/** Error function, A&S 7.1.26 (|error| < 1.5e-7). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax)
  return sign * y
}

/**
 * Returns the probability that a normally distributed carry (mean, sd) exceeds
 * a threshold: 1 - CDF(threshold). A zero/negative SD degenerates to a step.
 */
export function probExceed(mean: number, sd: number, threshold: number): number {
  if (sd <= 0) return threshold < mean ? 1 : 0
  const cdf = 0.5 * (1 + erf((threshold - mean) / (sd * Math.SQRT2)))
  return 1 - cdf
}
