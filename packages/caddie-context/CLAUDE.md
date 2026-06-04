# caddie-context — CLAUDE.md

The five-layer assembler, tone library, and the four locked personas.

- **Invariant #5:** layers compose in precedence order; Layer 1 (accuracy) wins. This package may *shape* the prompt but never lets a voice or preference override a number, invent a yardage, or recommend a clear loser.
- **Invariant #6:** personas are voice × risk-config, locked. Voice-only swap must return an identical target.
- This package does **no math** (that's sg-engine) and **no I/O for secrets** (that's services/api).

Phase 0 ships only the locked layer order. The assembler lands in Phase 3.
