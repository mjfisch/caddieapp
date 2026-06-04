// @gai/shared — types & constants shared across packages. No runtime deps.

/**
 * Confidence flag — invariant #2. Every club's data quality is one of these,
 * and the caddie's certainty must track it end-to-end into the voice:
 *   measured -> decisive | partial -> hedged | seeded -> named as a placeholder.
 * The visual language reinforces it (Brief section 10):
 *   measured = green (--green) | partial = amber (--amber) | seeded = faint grey (--faint).
 */
export type ConfidenceFlag = "measured" | "partial" | "seeded";

/** Token color for a confidence flag — keeps data model and visual language in lockstep. */
export const CONFIDENCE_COLOR: Record<ConfidenceFlag, string> = {
  measured: "var(--green)",
  partial: "var(--amber)",
  seeded: "var(--faint)",
};

/**
 * The five context layers, in precedence order (README_caddie_context_architecture.md).
 * Layer 1 (accuracy) wins — invariant #5. Index 0 = highest precedence.
 */
export const CONTEXT_LAYERS = [
  "accuracy", // Layer 1 — the numbers from the SG engine. Never overridden.
  "core",     // Layer 2 — core caddie rules
  "profile",  // Layer 3 — player_profile_michael.md
  "persona",  // Layer 4 — voice x risk-config
  "situation",// Layer 5 — the live hole/shot context
] as const;
export type ContextLayer = (typeof CONTEXT_LAYERS)[number];
