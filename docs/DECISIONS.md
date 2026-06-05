# Decision log (repo-local mirror)

The living decision log is Build Plan §10. This file records decisions resolved *in the build repo* so they travel with the code. Keep it in sync with the Build Plan.

## D2 — Database provider: **Neon** (RESOLVED, 2026-06-04, Phase 0)

Plain Postgres, no PostGIS (per D2/D9 — no live geometry). For a solo, DB-only-for-now build:

- **Neon chosen.** Lean serverless Postgres, first-class Vercel integration (env auto-wiring), scale-to-zero (cheapest for intermittent solo use), DB branching that maps onto per-phase schema experiments and the prep-vs-read split. `@neondatabase/serverless` is built for the Vercel-function execution path invariant #3 already mandates.
- **Supabase deferred.** Its value (auth, storage, RLS, realtime) is all Phase-6 (multi-user / monetizing) concern. The profile is currently a single canonical markdown doc, not multi-tenant — so that weight isn't used yet.
- **Lock-in risk ≈ 0 by design.** No PostGIS, no provider extension. Plain Postgres on a connection string; `pg_dump | psql` moves to Supabase later if multi-user auth is ever pulled forward. That single scenario is the only thing that would flip this.
- **Implementation note.** Phase 0 uses the standard `pg` driver (works against Neon's pooler *and* local Postgres — identical code path, verifiable locally). The `@neondatabase/serverless` driver is a one-line swap later if edge cold-starts warrant it; deferred to avoid premature optimization.

## D-2B-1 — Measured threshold drops to 5 shots for this bag (RESOLVED, 2026-06-05, Phase 2B)

The importer flips a club to `measured` at `MEASURED_MIN_SHOTS = 10` real shots. Michael's bag was logged in small sessions: every one of the 13 clubs has 5–12 real shots, but the 8 long-iron/hybrid/wedge clubs sit at 5–6 — below 10 — so they stayed `seeded` (tier-model estimates) while the engine was about to read them.

- **Decision.** For the SG engine to read the whole bag with real dispersion, promote any club with **≥ 5 real shots** to `measured`. Implemented as `seedDispersion.promoteMeasuredByShotCount(pool, 5)`, which **recomputes** carry mean / carry SD / lateral SD from the `shot` table at that threshold — it does not relabel a seeded estimate. This keeps invariant #2 honest: a `measured` flag always means real measured numbers.
- **Why not a flag-only `UPDATE`.** `club_dispersion.shot_count` is stale at 0 for the sub-10 clubs (recompute never wrote it), so a literal `WHERE shot_count >= 5` flips nothing, and flipping the flag without recomputing would label seeded estimates as measured — an invariant #2 violation.
- **Scope.** This is a per-bag data-quality call for a single-player build, not a change to the importer's default (still 10). 5 shots is thin; revisit if multi-player data lands. Confidence still only ratchets up — a `measured` club is never downgraded.

## D-3A-1 — Five-layer vocabulary relocked to assembler-section names (RESOLVED, 2026-06-05, Phase 3A)

The locked layer order in `@gai/shared` `CONTEXT_LAYERS` was renamed from the original semantic roles `accuracy / core / profile / persona / situation` to the assembler-section names `core_rules / course_hole / player_profile / persona_voice / live_input`. `@gai/caddie-context` `LAYER_ORDER` is the standalone definition (Phase 3A spec) and mirrors `CONTEXT_LAYERS` exactly.

- **Why.** The Phase 3A assembler spec defines its own five `LAYER_ORDER` names and requires exporting them as `LAYER_ORDER` from `@gai/caddie-context`. The previous export aliased `CONTEXT_LAYERS`; a single exported symbol cannot hold both vocabularies. Per CLAUDE.md, redefining the five-layer architecture requires a decision-log entry — this is it.
- **Same architecture, new labels.** The five layers and their precedence are unchanged. Layer 1 is still the inviolable accuracy/rules layer that wins (invariant #5); `core_rules` *is* "accuracy wins" expressed as the hard-constraint block. The engine's numbers now live under Layer 2 (`course_hole`), where the `StrategyResult` is rendered.
- **Drift guard.** The invariant #5 test still asserts `LAYER_ORDER` deep-equals `CONTEXT_LAYERS`, so the two definitions cannot silently diverge. One existing test (`invariant #5`) was updated to the new vocabulary; all other tests carry forward untouched.
- **Scope.** Naming only. No persona/risk-config change (invariant #6 untouched), no math change, no I/O added to `caddie-context`.

## D16 — Two design systems (RESOLVED v2.1, 2026-06-04)

GAI Caddie product UI = the dark as-built tokens (this repo's `globals.css`). BTP brand = the agency's light marketing identity, never app chrome — only a "Built by Back Tee Partners" attribution. See Build Plan §10 D16 for the full entry.
