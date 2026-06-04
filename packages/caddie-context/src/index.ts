// @gai/caddie-context — the five-layer assembler, tone library, personas.
//
// INVARIANT #5: the five layers compose in precedence order; Layer 1 (accuracy) wins.
// INVARIANT #6: personas are voice x risk-config, and they're locked.
// This package assembles context for the LLM — it NEVER does math (that's @gai/sg-engine)
// and NEVER lets a persona voice override a number or recommend a clear loser.

import { CONTEXT_LAYERS, type ContextLayer } from "@gai/shared";

/** Re-export the locked layer order so the assembler has a single source of truth. */
export const LAYER_ORDER: readonly ContextLayer[] = CONTEXT_LAYERS;

// Phase 3 surface (not yet implemented):
// export function assembleContext(layers: LayerInputs): AssembledPrompt;
