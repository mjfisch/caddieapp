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

## D-3B-1 — Fox Bend seed tee-column mismatch corrected (RESOLVED, 2026-06-05, Phase 3B)

The original 002 seed loaded tee yardages into mis-named columns: the back (Black) tee landed in `yardage_white` and the actual White tee in `yardage_blue`. `strategy.ts` had to read `yardage_blue` as the White tee — a latent footgun.

- **Decision.** Name-match the columns to tee colors. Added a `yardage_black` column (in `001` for fresh DBs; via `ALTER … IF NOT EXISTS` in `004` for already-seeded DBs). Mapping is now **Black→`yardage_black`, White→`yardage_white`, Gray→`yardage_red`**, and `yardage_blue` is NULL (Fox Bend has no Blue tee). Hole 3 White = 150 lives in `yardage_white`; the engine still returns 8i / 150 carry.
- **Note on this entry.** The draft one-liner read "White tee yardage now in `yardage_blue`" — that was the pre-fix (broken) state, not the fix. The fix puts White in `yardage_white`; this entry records what was actually done.
- **Why a new migration, not an edited re-run.** Applied 002 migrations are recorded in `_migrations` and never re-run; re-running 002's non-idempotent `INSERT` would create a *duplicate* Fox Bend course. So live data was corrected by a new `004` migration with **explicit canonical values** (not a positional swap), scoped to Fox Bend and idempotent — a true no-op on a fresh DB seeded by the corrected `002`. Re-seeded against live Neon.
- **Scope.** `001` (+column), `002` (correct insert), `004` (live fix), `strategy.ts` (reads `yardage_white`), hole page (shows Black/White/Gray). No engine/persona/math change (invariants #1/#6 untouched).

## D12 — Practice tab is the feedback loop's input/output surface, not a standalone logger (RESOLVED, adopted — docs/practice-tab-spec.md)

The Practice tab writes to dispersion (via the Shot Logger) and to club confidence; it reads from scoring (`round_hole`), dispersion, and the confidence flags; it reuses the Caddie assembler via a Layer-5 swap. It is not a siloed feature — it is the mechanism by which real practice data flows back into the SG engine and changes caddie recommendations. The spec (`docs/practice-tab-spec.md`) is now canonical; Phase 4.5 is the target build phase.

## D13 — Two-confidence model: data confidence (`measured/partial/seeded`) vs feel confidence (1–4) (RESOLVED, adopted — docs/practice-tab-spec.md)

Data confidence tracks the statistical quality of dispersion measurements (invariant #2, already locked). Feel confidence is a separate, per-club 1–4 subjective signal entered in the Practice tab that can nudge the strategy risk config — more aggressive when you're feeling it, more conservative when you're not. The two signals are stored and displayed separately; feel never overwrites the data confidence flag.

## D14 — Practice coach reuses the 5-layer assembler via a Layer-5 swap (RESOLVED, adopted — docs/practice-tab-spec.md)

The AI practice coach is not a second AI system. It uses the same `@gai/caddie-context` assembler as the on-course caddie, with Layer 5 (`live_input`) swapped out for a practice-session context block (ranked signals, session type, feel confidence). This means persona voice, player profile, and the Layer-1 accuracy rules all apply to coach output without duplication. See `docs/practice-tab-spec.md §4`.

## D15 — Drill resource links come from a curated library or live `web_search` — never LLM-invented (RESOLVED, adopted — docs/practice-tab-spec.md)

The practice coach must never fabricate a drill URL or attribute a drill to a source the model cannot verify. Links are sourced from a curated library of known-good resources OR from a real server-side `web_search` at generation time. This is the practice-domain expression of invariant #4 ("the LLM never invents a URL") and must be enforced the same way — in the server route, before the response streams to the client.

## D16 — Two design systems (RESOLVED v2.1, 2026-06-04)

GAI Caddie product UI = the dark as-built tokens (this repo's `globals.css`). BTP brand = the agency's light marketing identity, never app chrome — only a "Built by Back Tee Partners" attribution. See Build Plan §10 D16 for the full entry.

## D17 — Rebrand: GAI Caddie → Capt. 69 OS (RESOLVED, 2026-07-09, Mission 3.5)

Name-level rebrand only — strings, metadata, and docs. No schema change, no behavior change, no theme/layout change.

- **Display name: "Capt. 69 OS".** Header wordmark renders CAPT. 69 OS in the existing header style — "OS" in the accent green (the existing `--green` token), the rest in the existing light text color. Fonts unchanged.
- **Origin.** Capt. 69 is Michael's nickname (he shot 69). The existing Captain 69 persona is unchanged, and Rain Man remains the default coach voice — the brand and the persona coexist. No persona config touched.
- **Tagline: "Built for the next 69".** Replaces "The strokes-gained engine, in your pocket" everywhere it appeared (hero copy, metadata description).
- **Slug: `capt69os`.** Michael adds `capt69os.vercel.app` as a domain in the Vercel dashboard by hand — no domain config in code. Verified nothing in code hardcodes `caddieapp-web` in a way that would break under a second domain.
- **Interim mark.** A minimal SVG favicon/app icon: a thin circle outline in the accent green containing "69" in the house mono font (JetBrains Mono Bold glyph outlines, so no font dependency at render time) on the navy background — the scorecard circled-number = under-par notation. Files: `capt69-favicon.svg`, `capt69-icon.svg`; `favicon-32.png` / `favicon-180.png` re-rendered from the same mark. A refined logo replaces it later.
- **Theme, colors, layout: unchanged.**
- **Deliberately NOT renamed:** the GitHub repo, the `@gai/*` package scopes, anything in the database, persona definitions, and any file path that ripples through imports — invisible plumbing, not worth the import churn. Historical D-entries above keep the old name; this entry records the rename.
