# Decision log (repo-local mirror)

The living decision log is Build Plan §10. This file records decisions resolved *in the build repo* so they travel with the code. Keep it in sync with the Build Plan.

## D2 — Database provider: **Neon** (RESOLVED, 2026-06-04, Phase 0)

Plain Postgres, no PostGIS (per D2/D9 — no live geometry). For a solo, DB-only-for-now build:

- **Neon chosen.** Lean serverless Postgres, first-class Vercel integration (env auto-wiring), scale-to-zero (cheapest for intermittent solo use), DB branching that maps onto per-phase schema experiments and the prep-vs-read split. `@neondatabase/serverless` is built for the Vercel-function execution path invariant #3 already mandates.
- **Supabase deferred.** Its value (auth, storage, RLS, realtime) is all Phase-6 (multi-user / monetizing) concern. The profile is currently a single canonical markdown doc, not multi-tenant — so that weight isn't used yet.
- **Lock-in risk ≈ 0 by design.** No PostGIS, no provider extension. Plain Postgres on a connection string; `pg_dump | psql` moves to Supabase later if multi-user auth is ever pulled forward. That single scenario is the only thing that would flip this.
- **Implementation note.** Phase 0 uses the standard `pg` driver (works against Neon's pooler *and* local Postgres — identical code path, verifiable locally). The `@neondatabase/serverless` driver is a one-line swap later if edge cold-starts warrant it; deferred to avoid premature optimization.

## D16 — Two design systems (RESOLVED v2.1, 2026-06-04)

GAI Caddie product UI = the dark as-built tokens (this repo's `globals.css`). BTP brand = the agency's light marketing identity, never app chrome — only a "Built by Back Tee Partners" attribution. See Build Plan §10 D16 for the full entry.
