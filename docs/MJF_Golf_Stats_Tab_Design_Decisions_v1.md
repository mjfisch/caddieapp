# Stats Tab — Design Session Decision Doc v1.0

*Capt. 69 OS · July 10, 2026*
*Locks the decisions for the Play tab teardown, the Stats tab build, and the data-import architecture. Decisions D18–D27 below are proposed for merge into `docs/DECISIONS.md` upon Michael's approval. Where this doc conflicts with the Practice Tab Spec v2, this doc wins for Stats-related scope.*

---

## 1. Scope and identity shift

The Play tab (live-round, on-course mode) is retired entirely. The Plan tab (yardage book) is retired in its current form and pivots to a coaching surface. With both gone, Capt. 69 OS is no longer a caddie app — it is a **personal golf data OS**: Stats records what happened, Plan interprets it and directs practice, Practice logs the work, Bag describes what the clubs do.

No import UI is built into the app. All data preparation happens in the MJF Golf Claude project (screenshot parsing, validation, payload authoring), and data enters the app as version-controlled files synced at runtime — the same pattern that fixed migrations in Mission 2.6.

---

## 2. Decisions

**D18 — Play tab retired.** All Play tab UI, routes, and live-round components are removed. On-course/GPS functionality is out of scope indefinitely. The `course` and `hole` tables behind it are **retained and extended** — par-per-hole feeds every derived stat. The two existing test rounds (Jun 5, Jun 13, `is_test = true`) are excluded from all Stats queries; delete or keep at teardown discretion. `hole_feature` (v1 polygon-era) is confirmed dead or dropped during the teardown inventory.

**D19 — Plan tab pivots to coaching surface.** The yardage book is retired. Plan's new mandate: surface game weaknesses, interpret Stats tab data into practice direction, and recommend drills (absorbing the drill-library redesign already on the board). The narrative layer deliberately kept out of Stats (detonator chain, press-and-compound pattern, benchmarking) lives here. **Design deferred to its own session after Stats ships** — Plan cannot interpret data that doesn't exist yet.

**D20 — Navigation reshape.** Bottom nav becomes **Plan · Stats · Practice · Bag** (Stats takes Play's slot). Home screen: "Open the yardage book" and "Play a round" cards removed, replaced by a Stats card; Practice card stays.

**D21 — No in-app import flows, ever.** The round-entry grid is never built. The inert "Import Trackman screenshots" button is removed from the Practice tab (retiring the largest engineering lift on the board). Both pipelines run through the Claude project instead: the existing `mjf-trackman-shot-logger` skill for range data, and a new **`mjf-round-logger`** skill (to be built in the Claude project, not a Claude Code mission) that parses GolfLogix round screenshots plus the CDGA differential screenshot and emits one canonical round payload per round.

**D22 — Data-as-code round sync.** Rounds live in the repo as `data/rounds/*.json`, one file per round. A build-time manifest (mirroring the migration manifest) feeds an idempotent runtime sync that runs alongside `runMigrations()`: already-imported rounds are skipped silently (keyed on `external_key`), malformed payloads **fail loudly** — never a silent no-op. The full loop: play round → screenshots to Claude project → canonical JSON produced → handed to Claude Code → PR → merge → live on next page load. No `DATABASE_URL` required anywhere, consistent with the cloud-session constraint. Round history becomes version-controlled in GitHub.

**D23 — Differential is stored, never computed in-app.** Each round payload carries its scoring differential, captured at prep time: CDGA-posted value when available (Michael provides the CDGA app screenshot), otherwise computed by Claude using proper adjusted-gross (net double bogey) math during prep. Consequence: **no hole stroke-index in the schema.** Rating and slope are kept on the tee box for reference and payload validation only.

**D24 — Rounds are never deleted.** "Archived" means outside the 20-round window, not removed. All Stats views are query windows over the full `round` table. Storage is free; deleted data is unrecoverable, and multi-season comparisons (2026 vs 2027) become possible for free.

**D25 — Stats tab is a clean data surface.** Three filters, seven stat groups (§4). No narrative, insight cards, or coaching copy — that is Plan's job (D19).

**D26 — Club Confidence moves to the Bag tab, removed from Practice.** This restores the original spec §7 placement: the panel describes what the clubs do, so it belongs alongside carry and dispersion in the Bag, not in the session logger. The relocation is a small standalone UI mission with no schema impact, sequenced off the Stats critical path (see §5) so it never delays S1–S6.

**D27 — Backfill: 20 most recent rounds via the round-logger loop.** Source of truth is GolfLogix, which has hole-by-hole data **including fairway miss direction for all rounds**. The May 19 extraction folder (`MJF_Golf_Scorecard_Extraction_2026-05-19`) is reference/inspiration only, not the ingestion path — direction was skipped in that bulk pass and one-round-at-a-time processing with follow-up questions recovers it. Target: full directional coverage on all 20 seed rounds.

---

## 3. Data model

### Schema changes (one migration mission; auto-applies on deploy per Mission 2.6)

| Table | Change |
|---|---|
| `course` | Add `slug` if not present (payload matching key) |
| `tee_box` | New (or extended if exists): `course_id`, `name`, `rating numeric`, `slope int`, `yardage int` (optional) |
| `round` | Add `tee_box_id`, `differential numeric NOT NULL`, `differential_source` (`cdga_posted` \| `computed_adjusted`), `reflection text` (nullable), `external_key text UNIQUE` (`YYYY-MM-DD_course-slug`, the sync idempotency key) |
| `round_hole` | Add `fairway_result` (`hit` \| `miss_left` \| `miss_right` \| `NULL`); NULL required on par 3s. Backfill from existing `fairway_hit` boolean where present, then deprecate the boolean. Existing `penalty_strokes` column stays but is not surfaced |

**Everything else is derived, never entered** ("derived ≠ measured"): pars/birdies/eagles/bogeys/doubles fall out of strokes-vs-par; GIR%, putting splits, par-type scoring, and FW splits are all views over `round_hole`.

**Validation layers note (Mission 1 lesson):** with no client entry form, `fairway_result` and `differential_source` are validated in the payload schema (Claude-side), the sync validator (server), and the DB CHECK. These move together — inventory-first before any change.

### Canonical round payload (draft — final schema locked when the round-logger skill is built)

```json
{
  "external_key": "2026-07-24_fox-bend",
  "date": "2026-07-24",
  "course": { "name": "Fox Bend Golf Course", "slug": "fox-bend" },
  "tee_box": { "name": "Blue", "rating": 71.2, "slope": 128, "yardage": 6584 },
  "score": {
    "gross": 76,
    "differential": 4.2,
    "differential_source": "cdga_posted"
  },
  "holes": [
    {
      "hole": 1,
      "par": 5,
      "strokes": 5,
      "putts": 2,
      "fairway_result": "hit",
      "gir": true
    }
  ],
  "reflection": "Optional round-level note."
}
```

Payloads are self-contained: par-per-hole travels with the round so the sync can validate against (or seed) the course model for new courses.

**Sync validation rules (fail loudly on any violation):**

1. Exactly 18 hole entries, hole numbers 1–18 unique
2. `sum(holes[].strokes) == score.gross`
3. `putts <= strokes` on every hole
4. `fairway_result` is NULL **iff** the hole is a par 3
5. `differential` and `differential_source` present
6. `external_key` matches `date` + `course.slug`; duplicate keys skip silently (idempotency), everything else throws

---

## 4. Stats tab spec

### Filters (three query windows, all excluding `is_test`)

| Filter | Definition |
|---|---|
| **Last 20** | The 20 most recent rounds by date (the rolling handicap-eligible window) |
| **YTD** | All rounds dated in the current calendar year (may be more or fewer than 20) |
| **Handicap 8** | The 8 lowest differentials among the Last 20 (the rounds actually driving the index) |

### Stat groups (seven, all derived)

1. **Average gross score**
2. **Average differential**
3. **Fairways — three-way split:** hit% / missed-left% / missed-right%, summing to 100%. Denominator is driveable holes only (par 4s and 5s, i.e. holes with non-NULL `fairway_result`). Par 3s never count. Post-backfill there should be no unknown-direction misses; if one ever exists it is excluded from the denominator, not silently binned.
4. **GIR %**
5. **Putting:** average total putts per round, plus average count per round of 1-putt, 2-putt, and 3+ putt holes
6. **Scoring by par type:** average strokes on par 3s, 4s, and 5s, displayed with the vs-par delta (e.g., `4.30 (+0.30)`) so it reads consistently across courses with different par mixes
7. **Score distribution per round:** average birdies-or-better, pars, bogeys, and doubles-or-worse

Visual design of the stat cards follows the established conventions ("blocks not blobs," "one interaction pattern everywhere"); a mockup-options step precedes the build mission, per Michael's preference for options shown visually.

---

## 5. Mission sequence

| # | Mission | Notes |
|---|---|---|
| S1 | **Read-only inventory** | Play tab surface, routes, components; `round`/`round_hole`/`course`/tee schema as-built; `hole_feature` row count; every layer currently validating fairway/round fields. Mission-1-style, no writes |
| S2 | **Play tab teardown + nav reshape** | Remove Play UI/routes/home cards, Trackman import button; nav becomes Plan · Stats · Practice · Bag (Stats slot stubbed); drop confirmed-dead tables |
| S3 | **Schema migration** | Everything in §3; auto-applies on deploy |
| S4 | **Round sync mechanism** | `data/rounds/` manifest + runtime sync + validators; proven with one smoke round end-to-end (mirror of the Mission 2.6 / migration-010 proof) |
| S5 | **Backfill** | 20 rounds through the round-logger loop in the Claude project → one batch PR of payload files. Full directional FW coverage is the target |
| S6 | **Stats tab UI** | Mockup options first, then build: 3 filters × 7 stat groups |
| S7 | **Plan tab design session** | Separate session, separate spec — opens only after S6 ships |
| CC | **Club Confidence → Bag** | Standalone relocation per D26 (spec §7 placement restored): panel removed from Practice, rendered in Bag. UI-only, no schema impact, **off the critical path** — slot into any gap between missions |

**Parallel workstream (Claude project, not Claude Code):** build the `mjf-round-logger` skill before S5, modeled on the Trackman shot-logger — GolfLogix screenshots + CDGA screenshot in, validated canonical JSON out, every time, same format. The app now depends on this loop for freshness; the skill is what makes it a 10-minute habit instead of a chore.

---

## 6. Explicitly out of scope

Live GPS / on-course mode (indefinitely) · in-app round entry grid (never) · in-app Trackman import pipeline (never) · penalty tracking in the entry flow (column retained, unsurfaced) · hole stroke-index in schema (differential arrives pre-computed) · narrative/insight surfaces in Stats (Plan's job) · Plan tab redesign details (S7, own session).

---

*v1.0 — July 10, 2026. Supersedes the round-import portions of the original Stats scoping in the Practice-era handoff. Next action on approval: stage Mission S1 in Claude Code and merge D18–D27 into `docs/DECISIONS.md`.*
