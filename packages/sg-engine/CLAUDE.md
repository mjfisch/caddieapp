# sg-engine — CLAUDE.md

**Deterministic. No I/O. No network. No DB. No clock in a decision path. No randomness.**

This package is invariant #1 made concrete: all strokes-gained / dispersion / EV math lives here, in pure code. The LLM only narrates what these functions return — it never computes. Same input → same output, always. The invariant tests guard this; keep them green.

Real SG math lands in Phase 2 (`predictHole(hole, dispersion, persona)`). Phase 0 ships only a version constant and a purity probe.
