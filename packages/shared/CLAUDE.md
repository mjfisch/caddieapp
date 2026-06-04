# shared — CLAUDE.md

Types and constants shared across packages. **No runtime dependencies, no I/O.**

Home of the `ConfidenceFlag` type (invariant #2) and the locked `CONTEXT_LAYERS` order (invariant #5) — single definitions everything else imports, so the model and the data layer can't drift apart.
