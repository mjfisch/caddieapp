# Stats Tab Redesign — Mission S1 Read-Only Inventory

*Companion to `MJF_Golf_Stats_Tab_Design_Decisions_v1.md` (D18–D27). This is the code-and-schema teardown map for the Play/Plan retirement and the Stats-tab build: READ-ONLY, no application-code or schema changes. Mirrors the format and rigor of `inventory_practice_redesign.md`. Traces every Play/Plan surface, the `course`/`hole`/`round`/`round_hole` schema as-built, the validation layers on round fields, the migration-manifest machinery a `data/rounds/` sync (D22) must mirror, and the surprises that will bite S2–S4.*

*Trace date: 2026-07-10. Branch: `claude/stats-tab-redesign-inventory-kub5qm`. No `DATABASE_URL` in this session — every live-data question is emitted as read-only SQL + a **PENDING VERIFICATION** flag.*

*Classification legend: **PLAY-ONLY** = exists only to serve the Play tab / live-round mode, safe to delete in S2. **SHARED** = must survive S2 because Practice, Bag, the Plan/coaching surface, or the data layer also reads/writes it.*

---

## 1. Play tab surface map

The Play tab is the on-course, live-round ("Mode B") surface. Everything under `apps/web/src/app/play/` plus the round persistence API and the home-screen "Play a round" card.

### 1a. Routes / pages (all under `apps/web/src/app/play/`)

| Path | File | What it does | Class |
|---|---|---|---|
| `/play` | `play/page.tsx` | Course picker ("Play a round"). Server component, `getPool()` direct query `SELECT id,name,city,state FROM course`. | **PLAY-ONLY** (UI). Reads SHARED `course`. |
| `/play/[courseId]` | `play/[courseId]/page.tsx` | Course play index: hole list + "Past rounds". Queries `hole`, calls `listRounds(courseId)` + `runMigrations()`. | **PLAY-ONLY** (UI). Reads SHARED `hole`, `round`. |
| `/play/[courseId]/holes/[holeNumber]` | `play/[courseId]/holes/[holeNumber]/page.tsx` | Server wrapper: loads one `hole` row + hole count, renders `<HoleView>`. | **PLAY-ONLY**. Reads SHARED `hole`. |
| `/play/[courseId]/recap/[roundId]` | `play/[courseId]/recap/[roundId]/page.tsx` | Post-round recap: scorecard, stat tiles, weakness signals, caddie recap. `getRound` + `summarizeRound` + `computeScoringWeaknesses`. | **PLAY-ONLY** (UI). Reads SHARED `round`/`round_hole` + weakness engine. |

### 1b. Client components (Play-only)

| File | Role | Class |
|---|---|---|
| `play/[courseId]/holes/[holeNumber]/HoleView.tsx` | The Mode B on-course view. Persona + conditions sheet, auto-fires `/api/strategy`, score/putt chips → localStorage + fire-and-forget `POST /api/rounds/[id]/holes`. Creates the round on mount via `POST /api/rounds`. | **PLAY-ONLY** |
| `play/[courseId]/HoleList.tsx` | Client hole list; reads saved scores from localStorage (`gai-play-scores`). "Start round →". | **PLAY-ONLY** |
| `play/[courseId]/PastRounds.tsx` | Past-rounds list with per-round Delete + "mark as test" toggles. `fetch DELETE/PATCH /api/rounds/[id]`; calls `reconcileDeletedRound`. | **PLAY-ONLY** |
| `play/[courseId]/recap/[roundId]/RecapCoach.tsx` | Load-on-demand caddie recap; `POST /api/rounds/[id]/recap` SSE. | **PLAY-ONLY** |
| `play/roundStorage.ts` | Pure localStorage reconciliation for deleted rounds (`ROUND_ID_KEY`, `SCORES_KEY`, `PUTTS_KEY`). Unit-tested. | **PLAY-ONLY** |

### 1c. API endpoints serving Play / live-round

| Route | File | Server fn (`@gai/api`) | Class |
|---|---|---|---|
| `POST /api/rounds` | `api/rounds/route.ts` | `createRound` | **SHARED** — see note below. The write path for round rows. |
| `GET /api/rounds?courseId=` | `api/rounds/route.ts` | `listRounds` | **SHARED** (Stats will need a rounds list) |
| `GET /api/rounds/[roundId]` | `api/rounds/[roundId]/route.ts` | `getRound` | **SHARED** |
| `DELETE /api/rounds/[roundId]` | `api/rounds/[roundId]/route.ts` | `deleteRound` | **PLAY-ONLY** by D24 (rounds are never deleted) — the delete UI + route retire, but see §5/§9. |
| `PATCH /api/rounds/[roundId]` | `api/rounds/[roundId]/route.ts` | `markRoundTest` | **SHARED-ish** — `is_test` survives (Stats excludes test rounds), but the on-course PATCH UI is Play-only. |
| `POST /api/rounds/[roundId]/holes` | `api/rounds/[roundId]/holes/route.ts` | `upsertRoundHole` | **PLAY-ONLY** by D21/D22 — the live upsert write path is replaced by the `data/rounds/` sync. |
| `POST /api/rounds/[roundId]/recap` | `api/rounds/[roundId]/recap/route.ts` | `runRoundRecapStream` | **PLAY-ONLY** (recap is a play-flow surface; narrative moves to Plan per D19/D25). |
| `GET /api/rounds/scoring-weaknesses` | `api/rounds/scoring-weaknesses/route.ts` | `computeScoringWeaknesses` | **SHARED** — the Practice coach ranker reads this (see §9). |
| `POST /api/strategy` | `api/strategy/route.ts` | `runStrategyStream` | **SHARED between Play and Plan** — both `HoleView` and `StrategyPanel` call it. Retired only when *both* tabs are gone (Plan pivots per D19, timing TBD). |

> **Note — `@gai/api` server module `rounds.ts` is SHARED, not Play-only.** All round DB access lives in `services/api/src/rounds.ts` (exported from `services/api/src/index.ts`). Even after the Play UI is gone, Stats reads rounds through these functions and the D22 sync writes through (a variant of) `createRound`/`upsertRoundHole`. **Do not delete `rounds.ts` in S2** — retire only the Play *UI* + the live-write routes (`/holes`, `/recap`, on-course `DELETE`). `summarizeRound`, `computeScoringWeaknesses`, `getRound`, `listRounds`, `markRoundTest` all carry forward into Stats/coach.

### 1d. Home-screen cards

`apps/web/src/app/page.tsx` — the landing page. The `ENTRIES` array (lines 56–66) defines three cards:

| Card | href | Line | D20 disposition |
|---|---|---|---|
| "Open the yardage book" (primary) | `/courses` | 63 | **REMOVE** (Plan yardage book retired, D19/D20) |
| "Play a round" | `/play` | 64 | **REMOVE** (D20) |
| "Practice" | `/practice` | 65 | **KEEP** (D20) |

D20 also calls for a new **Stats card** replacing the two removed. Icons are inline `EntryIcon` glyphs (`book`/`flag`/`target`, lines 31–54); removing the book+flag cards leaves `target` (Practice). A Stats card needs a new glyph. The confidence legend + `DispersionMark` on this page are unrelated (invariant #2 display) and stay.

### 1e. Bottom-nav definition (how tabs are registered)

- **Model:** `apps/web/src/app/_nav/tabs.ts` — a pure, React-free `TABS` array of `{ label, href, icon }`. Currently: `Plan → /courses`, `Play → /play`, `Practice → /practice`, `Bag → /bag`. `TabIcon` union = `"plan" | "play" | "practice" | "bag"`. `isActiveTab(pathname, href)` does exact + descendant matching with a trailing-slash guard.
- **Render:** `apps/web/src/app/_nav/BottomNav.tsx` — client component, `usePathname()`, maps `TABS`, hand-rolled inline-SVG `TabIconGlyph` per icon (`plan` = folded map, `play` = pin flag, `practice` = target, `bag` = golf bag). Mounted once in `apps/web/src/app/layout.tsx` (`<BottomNav/>` after `{children}`).
- **Test lock:** `tests/bottom-nav.test.ts` asserts **exactly 4 tabs**, the exact `href` order `["/courses","/play","/practice","/bag"]`, and the exact label order `["Plan","Play","Practice","Bag"]`, plus `isActiveTab` behavior including `/play/glen-club/holes/3` lighting Play. **S2 must update this test in lockstep** or the nav reshape (D20: `Plan · Stats · Practice · Bag`, Stats at `/stats` taking Play's slot) fails CI. This is the Play-surface equivalent of the practice inventory's "three independent lists" lesson — the nav model + its test move together.

---

## 2. Plan tab (yardage book) surface map

Per D19 the Plan tab is retired **in its current form** and pivots to a coaching surface; teardown timing is TBD (S7), but the map is captured now. The Plan tab currently points at `/courses`.

### 2a. Routes / pages (all under `apps/web/src/app/courses/`)

| Path | File | What it does | Class |
|---|---|---|---|
| `/courses` | `courses/page.tsx` | Course list ("Courses"). `SELECT id,name,city,state FROM course`. | **PLAN-ONLY** (UI). Reads SHARED `course`. |
| `/courses/[courseId]` | `courses/[courseId]/page.tsx` | Hole grid for a course; `SELECT number,par,yardage_white,yardage_blue,yardage_red FROM hole`. | **PLAN-ONLY** (UI). Reads SHARED `hole`. |
| `/courses/[courseId]/holes/[holeNumber]` | `courses/[courseId]/holes/[holeNumber]/page.tsx` | Yardage-book hole page: satellite image, tee yardages (Black/White/Gray), **`hole_feature` chips**, notes, `<StrategyPanel>`. | **PLAN-ONLY** (UI). Reads SHARED `hole` + soon-dead `hole_feature`. |

### 2b. Client component

| File | Role | Class |
|---|---|---|
| `courses/[courseId]/holes/[holeNumber]/StrategyPanel.tsx` | Caddie-read panel: persona selector, conditions form, `POST /api/strategy` SSE, engine block + streamed prose, swing-overstep guard. | **PLAN-ONLY** (UI), but shares `/api/strategy` + `services/api/src/strategy.ts` with Play (§1c). |

### 2c. Plan-tab dependency on `hole_feature`

`/courses/[courseId]/holes/[holeNumber]/page.tsx` is the **only page that renders `hole_feature`** (queries it at lines 76–82, renders feature chips 186–233). `services/api/src/strategy.ts` (`loadHole`, lines 123–135) also reads `hole_feature` to feed the SG engine. Both the Plan hole page and the strategy read are the live consumers of `hole_feature` — see §4. Because Plan teardown is TBD (not S2), `hole_feature` and `/api/strategy` cannot be assumed gone until the Plan pivot mission runs.

---

## 3. Schema as-built (from migration files)

Sourced from `services/api/src/migrations/*.sql`. **Migration numbering high-water mark: `011_retire_net_type.sql`** — the next migration (S3 schema per D23/§3 of the design doc) is `012_…`. Ledger table is `_migrations (filename text PRIMARY KEY, applied_at timestamptz)`.

### 3a. `course` — `001_phase1_courses.sql:7`

```
id          uuid PRIMARY KEY DEFAULT gen_random_uuid()
name        text NOT NULL
city        text
state       text
created_at  timestamptz DEFAULT now()
```
No CHECK constraints, no FKs out. **No `slug` column** — D23/§3 adds `slug` (payload matching key) in S3. **Retained + extended** (D18).

### 3b. `hole` — `001_phase1_courses.sql:15`

```
id            uuid PRIMARY KEY DEFAULT gen_random_uuid()
course_id     uuid REFERENCES course(id) ON DELETE CASCADE
number        int NOT NULL
par           int NOT NULL
stroke_index  int
yardage_black int          -- added in 001 for fresh DBs; via 004 ALTER for live DBs
yardage_white int
yardage_blue  int          -- NULL for Fox Bend (no Blue tee)
yardage_red   int          -- holds the Gray/forward tee (D-3B-1 name-match)
notes         text
```
- **FK:** `course_id → course(id) ON DELETE CASCADE` (deleting a course removes its holes).
- No CHECK constraints. **`stroke_index` exists here** but D23 says no hole stroke-index in the *round* schema (differential arrives pre-computed) — the `hole.stroke_index` column is a separate, course-model field and is untouched by D23. `par` per hole is the load-bearing column for every derived Stats figure (D18). **Retained + extended** (D18).

### 3c. `hole_feature` — `001_phase1_courses.sql:31` (see §4 for the full teardown treatment)

```
id                uuid PRIMARY KEY DEFAULT gen_random_uuid()
hole_id           uuid REFERENCES hole(id) ON DELETE CASCADE
kind              text NOT NULL CHECK (kind IN ('bunker','water','ob','tree_line','forced_carry','green_complex'))
side              text CHECK (side IN ('left','right','center','front','back'))
distance_from_tee int
carry_to_clear    int
note              text
```
- **FK:** `hole_id → hole(id) ON DELETE CASCADE`.
- v1 polygon-era leftover (D18 flags it "confirmed dead or dropped during the teardown inventory").

### 3d. Tee-related tables

**There is no `tee_box` (or any tee) table today.** Tee data is denormalized as the four `yardage_*` columns on `hole` (§3b) plus rating/slope noted only in the `002` seed *comment* header (`Black 135/74 · White 128/71.2 · …`) — **rating/slope are not stored in any column anywhere.** D23/§3 introduces a **new `tee_box` table** (`course_id`, `name`, `rating numeric`, `slope int`, `yardage int?`) in S3; `round.tee_set` (a bare `text`, §3e) is today's only tee reference on a round.

### 3e. `round` — `007_phase5_rounds.sql:12` (+ `008` adds `is_test`)

```
id               uuid PRIMARY KEY DEFAULT gen_random_uuid()
course_id        uuid REFERENCES course(id) ON DELETE CASCADE
played_date      date NOT NULL
tee_set          text NOT NULL DEFAULT 'white'
total_strokes    int          -- nullable; NOT populated by the live flow (see §9)
total_putts      int          -- nullable; NOT populated by the live flow
fairways_hit     int          -- nullable; NOT populated by the live flow
fairways_possible int         -- nullable; NOT populated by the live flow
gir              int          -- nullable; NOT populated by the live flow
created_at       timestamptz DEFAULT now()
is_test          boolean NOT NULL DEFAULT false   -- migration 008
```
- **FK:** `course_id → course(id) ON DELETE CASCADE`.
- No CHECK constraints. `tee_set` is free-text (default `'white'`). **The five aggregate columns (`total_strokes`, `total_putts`, `fairways_hit`, `fairways_possible`, `gir`) are dead in practice** — `createRound` inserts only `course_id`/`played_date`/`tee_set`, and nothing else ever writes them (see §9 surprises). Every rendered round stat is recomputed from `round_hole` at read time by `summarizeRound`/`computeScoringWeaknesses`.
- **D23/§3 additions in S3:** `tee_box_id`, `differential numeric NOT NULL`, `differential_source` (`cdga_posted` | `computed_adjusted`), `reflection text` (nullable), `external_key text UNIQUE` (`YYYY-MM-DD_course-slug`).

### 3f. `round_hole` — `007_phase5_rounds.sql:25`

```
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
round_id        uuid REFERENCES round(id) ON DELETE CASCADE
hole_number     int NOT NULL
strokes         int NOT NULL
putts           int
fairway_hit     boolean
gir             boolean
penalty_strokes int DEFAULT 0
notes           text
UNIQUE (round_id, hole_number)
```
- **FK:** `round_id → round(id) ON DELETE CASCADE` (deleting a round removes its holes; verified by `tests/round-deletion.test.ts:109`).
- **Constraints:** `strokes NOT NULL`, `hole_number NOT NULL`, `UNIQUE(round_id, hole_number)` (the upsert key). No CHECK constraints; `fairway_hit`/`gir` are plain booleans (nullable), not enums.
- Indexes: `round_hole_round_idx (round_id)`, `round_course_date_idx` on `round (course_id, played_date DESC)`.
- **D23/§3 additions in S3:** `fairway_result` (`hit` | `miss_left` | `miss_right` | NULL; NULL required on par 3s), backfilled from `fairway_hit` then the boolean deprecated. `penalty_strokes` **stays but is not surfaced** (design doc §6).

### 3g. Cascade summary (delete directions)

```
course --(ON DELETE CASCADE)--> hole --(ON DELETE CASCADE)--> hole_feature
course --(ON DELETE CASCADE)--> round --(ON DELETE CASCADE)--> round_hole
```
Deleting a `course` cascades to holes, hole_features, rounds, and round_holes. There is **no FK from `round`/`round_hole` back to `hole`** — the recap/stats joins are done positionally on `(course_id, hole_number = number)` (see `getRound`/`computeScoringWeaknesses`), a LEFT JOIN that tolerates a missing hole row.

---

## 4. `hole_feature` — schema, references, row count SQL

### 4a. Schema
See §3c. FK `hole_id → hole(id) ON DELETE CASCADE`; `kind` CHECK (6 values), `side` CHECK (5 values).

### 4b. Every code reference to `hole_feature`

| File | Lines | Nature |
|---|---|---|
| `services/api/src/migrations/001_phase1_courses.sql` | 31–39 | `CREATE TABLE hole_feature` |
| `services/api/src/migrations/002_fox_bend_seed.sql` | feature INSERT | Seeds **29 rows** (per the migration's own summary comment: "hole_feature rows: 29 (Phase 1 — key features only)") for Fox Bend |
| `services/api/src/migrations/009_practice_redesign_schema.sql` | 25–34 | Read-only `SELECT count(*) … RAISE NOTICE` diagnostic; **explicitly leaves the table untouched** ("its removal needs its own decision-log entry" — D18 is now that entry) |
| `services/api/src/strategy.ts` | 123–135 | **Live read** — `loadHole` queries `kind,side,distance_from_tee,carry_to_clear FROM hole_feature WHERE hole_id=$1`, feeds `HoleFeature[]` to the SG engine |
| `apps/web/src/app/courses/[courseId]/holes/[holeNumber]/page.tsx` | 22–29, 76–82, 186–233 | **Live read + render** — the Plan yardage-book hole page (feature chips) |
| `services/api/src/migrations.generated.ts` | (embedded) | Auto-generated copy of 001/002/009 SQL strings |
| `tests/migrations.test.ts`, `tests/practice-redesign.test.ts` | — | Test references (assert 009's untouched-table behavior, etc.) |
| `docs/MJF_Golf_Practice_Tab_Spec_v2.md` | — | Doc reference only |

**Teardown consequence:** `hole_feature` has two *live* consumers, both on the Plan/strategy path (`strategy.ts` + the Plan hole page), **not** the Play tab. So dropping `hole_feature` in S2 is only safe if `/api/strategy` + the Plan hole page are also retired in the same mission; otherwise the SG engine loses its hazard inputs and the Plan hole page's feature chips break. Since Plan teardown is TBD (D19, S7), **coordinate the `hole_feature` drop with the Plan pivot, not the Play teardown** — or drop the table and simultaneously strip the two reads. Flag for the S2 decision.

### 4c. Row-count SQL — **PENDING VERIFICATION**

No `DATABASE_URL` in this session; run in the Neon SQL Editor:

```sql
-- hole_feature row count (D18 confirmation that it is dead/dropped-safe).
SELECT count(*) AS hole_feature_rows FROM hole_feature;

-- Optional breakdown by kind, to confirm it is only the Fox Bend Phase-1 seed (~29):
SELECT kind, count(*) AS n
  FROM hole_feature
 GROUP BY kind
 ORDER BY n DESC;
```
Seed expectation from `002`'s summary comment: **29 rows**, all Fox Bend, no runtime writer exists (nothing INSERTs `hole_feature` outside the `002` seed migration). **PENDING VERIFICATION** until Michael runs the above.

---

## 5. Validation-layer map (the "three independent lists" lesson, round edition)

For every categorical/constrained field on `round` and `round_hole`, the layers that validate it today. The Mission-1 lesson: **DB CHECK / server code / client code are independent and must move together.** Here the notable finding is the *opposite* of the practice-type case — most round fields have **no DB CHECK at all** and thin server validation, so S3's new `fairway_result`/`differential_source` CHECKs (design doc §3 "validation layers note") are *adding* a constraint layer where none existed.

| Field | DB layer | Server layer | Client layer |
|---|---|---|---|
| `round.is_test` | `boolean NOT NULL DEFAULT false` (`008`), no CHECK | `markRoundTest` (`rounds.ts:354`) rejects non-boolean → `RoundError(400)` | `PastRounds.tsx` toggle → `PATCH /api/rounds/[id]` `{isTest}` |
| `round.tee_set` | `text NOT NULL DEFAULT 'white'`, **no CHECK / no enum** | `createRound` (`rounds.ts:86`) coerces `teeSet?.trim() || "white"` | `HoleView` hardcodes `teeSet:"white"` in the create POST |
| `round.played_date` | `date NOT NULL` | `createRound` rejects empty string → 400 | `HoleView` `today()` |
| `round_hole.strokes` | `int NOT NULL` | `upsertRoundHole` (`rounds.ts:126`) requires positive integer → 400 | `HoleView` score chips 1–8 |
| `round_hole.putts` | `int` (nullable) | route coerces `typeof putts==="number" ? … : null` | `HoleView` putt chips 0–4 |
| `round_hole.fairway_hit` | `boolean` (nullable), **no CHECK** | route coerces `typeof fairwayHit==="boolean" ? … : null`; `upsertRoundHole` `?? null` | **Never set by the Play UI** (see §9) — the on-course view captures only strokes + putts |
| `round_hole.gir` | `boolean` (nullable), **no CHECK** | route coerces `typeof gir==="boolean" ? … : null` | **Never set by the Play UI** (see §9) |
| `round_hole.penalty_strokes` | `int DEFAULT 0`, **no CHECK** | route coerces `typeof penaltyStrokes==="number" ? … : null`; `upsertRoundHole` `?? 0` | **Never set by the Play UI** — column is inert today (design doc §6 keeps it unsurfaced) |
| `round_hole.hole_number` | `int NOT NULL`, `UNIQUE(round_id, hole_number)` | `upsertRoundHole` requires integer → 400 | `HoleView` from route param |

**Key finding for S3:** unlike `practice_session.type` (three synced lists), the round fields today have **no enum-like validation on the DB side** — `fairway_hit`/`gir`/`penalty_strokes` are unconstrained scalars, and `tee_set` is free text. The design doc's §3 note ("`fairway_result` and `differential_source` are validated in the payload schema (Claude-side), the sync validator (server), and the DB CHECK — these move together") is establishing a **new** three-layer pattern where none exists, this time across: (1) the Claude-side payload schema, (2) the D22 server sync validator, (3) the DB CHECK. There is no *client* form layer at all under the new model (D21: no in-app entry ever), which removes the third leg of the old practice-tab problem but adds the payload-schema leg.

### 5a. Current round-creation write path (what writes `round`/`round_hole` today)

1. **Round row:** `HoleView.tsx` mount effect (lines 159–187) → `POST /api/rounds` `{courseId, playedDate: today(), teeSet:"white"}` → `createRound` (`rounds.ts:69`) → `INSERT INTO round (course_id, played_date, tee_set)`. Validation: `courseId`/`playedDate` non-empty strings; FK violation mapped to 400. Round id cached in localStorage `gai-play-round-id` keyed by course+date (reused within the day).
2. **Hole rows:** `HoleView` `chooseScore`/`choosePutts` → fire-and-forget `POST /api/rounds/[roundId]/holes` `{holeNumber, strokes, putts}` → `upsertRoundHole` (`rounds.ts:115`) → `INSERT … ON CONFLICT (round_id, hole_number) DO UPDATE`. Only `strokes` + `putts` ever travel; `fairway_hit`/`gir`/`penalty_strokes`/`notes` default to null/0.
3. **localStorage is the source of truth for the active round** (`roundStorage.ts` header); Neon is the fire-and-forget persistence layer behind it. This is the exact write path **D22 replaces** with the `data/rounds/*.json` sync — the new path never touches `POST /api/rounds/[id]/holes` and never runs client-side.

**S3/S4 implication:** the D22 sync validator becomes the *sole* server-side write path for round data (payloads self-contain par-per-hole to seed/validate the course model). The old `createRound`/`upsertRoundHole` signatures don't carry `differential`, `fairway_result`, `tee_box_id`, or `external_key`; S3 extends them (or the S4 sync writes its own INSERTs). Since `differential` is `NOT NULL` (D23), the existing `createRound` (which never sets it) would violate the new constraint — S3/S4 must update the writer in lockstep with the migration, the round-side version of the "all layers move together" rule.

---

## 6. `is_test` — how it is set, and every query that filters (or fails to filter) it

- **Column:** `round.is_test boolean NOT NULL DEFAULT false` (`008_round_is_test.sql:17`).
- **Set by:** `markRoundTest(roundId, isTest)` (`rounds.ts:354`) ← `PATCH /api/rounds/[roundId]` ← `PastRounds.tsx` `toggleTest` (the "test" button per past round). Idempotent; validates boolean.
- **Filtered (excluded) in:** `computeScoringWeaknesses` (`rounds.ts:462`) — the SQL always adds `r.is_test = false` (D-5-1: test rounds kept but muted from the weakness signal). This is the **only** query that filters `is_test` today.
- **NOT filtered in (surfaces test rounds):**
  - `listRounds` (`rounds.ts:271`) — returns all rounds incl. test rounds, carrying `is_test` so `PastRounds.tsx` can badge them "TEST". (This is intentional for the play index.)
  - `getRound` (`rounds.ts:193`) — single-round read, no `is_test` predicate (fine; it's a by-id lookup).
  - `summarizeRound` (`rounds.ts:406`) — pure aggregation over a single round's detail; no notion of `is_test`.

**Stats implication (design doc §4 "all filters exclude `is_test`"):** every new Stats query (Last 20, YTD, Handicap 8) must add `WHERE is_test = false`, exactly as `computeScoringWeaknesses` does. Today only one query enforces it, so there is **one existing pattern to copy** and no existing Stats-window query to reuse — the Last-20 / YTD / lowest-8-differential windows are all net-new SQL. The two seeded test rounds (Jun 5, Jun 13, D18) are the live rows this predicate must hide.

---

## 7. The inert "Import Trackman screenshots" button (Practice tab)

- **Location:** `apps/web/src/app/practice/page.tsx:640–648` — the `{type === "trackman" && (…)}` "Trackman import bridge" block:
  ```jsx
  {/* Trackman import bridge */}
  {type === "trackman" && (
    <div className="pr-import">
      <div className="pr-import-tx">
        <b>Import Trackman screenshots</b>
        <small>Runs the Shot Logger skill → updates Bag dispersion</small>
      </div>
    </div>
  )}
  ```
- **Wired to:** **nothing.** It is a static `<div>` (class `pr-import`) with a bold label + subtitle — no `onClick`, no `href`, no handler, no fetch, no state. Purely informational copy. There is a *separate* explanatory paragraph at `page.tsx:539–541` ("Structured shot data. Import your screenshots via the Shot Logger skill (see README)…") in the `trackman` type note — that is prose, not the button, and S2 should decide whether it goes too (D21 removes "the inert button"; the note is adjacent copy).
- **CSS:** `pr-import` / `pr-import-tx` classes live in `apps/web/src/app/globals.css` (styling only).
- **S2 removal:** delete the lines-640–648 block. No handler or route to unwire (there is none), no state to clean up. Trivial excision. (D21 calls this "retiring the largest engineering lift on the board" — the *lift* was the never-built import pipeline this button gestured at; the button itself is a 9-line delete.)

---

## 8. Migration-manifest machinery (Mission 2.6) — the pattern D22 must mirror

D22 requires a build-time `data/rounds/` manifest feeding an idempotent runtime sync that runs alongside `runMigrations()`, mirroring the migration manifest exactly. Here is that machinery in enough detail to clone it.

### 8a. Build-time manifest generation
- **Script:** `services/api/scripts/generate-migrations-manifest.mjs`. Reads `services/api/src/migrations/*.sql`, `.sort()`s by filename, embeds each as a `{ filename, sql }` via `JSON.stringify`, and writes `services/api/src/migrations.generated.ts` (exports `MIGRATIONS: readonly MigrationFile[]`). Deterministic; throws if zero `.sql` files found.
- **When it runs:** `apps/web` `package.json` **`"prebuild"`** hook: `node ../../services/api/scripts/generate-migrations-manifest.mjs`, so it regenerates before every `next build`. The output is **checked in** (dev/tests need no build step).
- **Staleness guard:** `tests/migration-manifest.test.ts` fails if `migrations.generated.ts` drifts from the `.sql` files on disk. (The generator also exports `generateManifestSource()` so the test can compare.)
- **Why a manifest at all:** inside the Vercel serverless bundle the raw `.sql` files sit at no predictable path; the old `readdirSync` fallback silently no-oped on ENOENT (`docs/diagnostic_migration_009.md`). Embedding as strings makes discovery build-time and bundle-safe.

### 8b. Runtime invocation + failure behavior
- **Entry:** `runMigrations()` (`services/api/src/db.ts:40`) — memoized `Promise` so concurrent requests share one run; **a failure clears the memo so the next request retries.** Called at the top of every DB-touching route (`api/rounds/*`, `api/practice/*`, health, the Play/Plan pages via `runMigrations()` or implicitly).
- **Runner:** `applyMigrations()` (`db.ts:53`):
  - **Empty manifest ⇒ throws** ("refusing to serve against a DB whose state we can't establish") — loud failure, never a silent no-op.
  - Bootstraps `_migrations (filename PRIMARY KEY, applied_at)` in its own txn.
  - **One transaction per file**, each guarded by `pg_advisory_xact_lock(778899)` (transaction-scoped → auto-releases on COMMIT/ROLLBACK or dropped connection; serializes concurrent migrators so racing cold-starts don't collide on `CREATE TABLE`).
  - **Ledger check inside the lock:** `SELECT 1 FROM _migrations WHERE filename=$1`; if present, COMMIT + skip (this is what lets a manually-applied migration never re-run). Else run `sql`, then `INSERT … ON CONFLICT DO NOTHING`, COMMIT.
  - **Any failure ⇒ ROLLBACK + throw** `migration <file> failed: <msg>`. Already-committed earlier migrations stay applied.

### 8c. What a `data/rounds/` sync (D22) must replicate
- A **build-time generator** (mirror of `generate-migrations-manifest.mjs`) that reads `data/rounds/*.json`, sorts deterministically, embeds them as a checked-in `rounds.generated.ts` manifest, wired into the same `apps/web` `prebuild` step, with a matching staleness test.
- A **runtime sync** (mirror of `runMigrations`/`applyMigrations`) run alongside `runMigrations()`: memoized, advisory-locked, keyed on `external_key` for idempotency (already-imported rounds skip silently, like the `_migrations` ledger check), **malformed payloads throw** (mirror of the empty-manifest / failed-migration loud-fail). D22's "fail loudly, never a silent no-op" maps 1:1 onto this runner's existing discipline. A `_rounds_synced` ledger table keyed on `external_key` is the natural analog of `_migrations`.
- **No `DATABASE_URL` required at build time** (generation is filesystem-only); the sync needs the DB only at runtime, exactly like migrations — consistent with the cloud-session constraint (D22).

---

## 9. Surprises audit for S2–S4

1. **`round`'s five aggregate columns are dead.** `total_strokes`, `total_putts`, `fairways_hit`, `fairways_possible`, `gir` on `round` (§3e) are **never written** — `createRound` inserts only `course_id`/`played_date`/`tee_set`, and no other writer exists. Every round stat is recomputed from `round_hole` by `summarizeRound`/`computeScoringWeaknesses`. S3 can ignore/drop these columns; don't build Stats on them.
2. **The Play on-course UI never captures `fairway_hit` or `gir`.** `HoleView.syncHole` sends only `{holeNumber, strokes, putts}` (lines 191–208). So `round_hole.fairway_hit`/`gir` are **NULL for every app-created hole** — the recap's "Fairways hit" and "GIR" tiles and the fairway/scrambling weakness signals are effectively **unpopulated by live play** (they'd only be non-null via direct API calls or seeded data). **This is why D27's backfill matters:** the 20 seed rounds are the *only* realistic source of fairway/GIR/direction data, because the retired live flow never recorded it. Any current-looking fairway% in the recap is coming from seed rows, not on-course entry. **PENDING VERIFICATION** — confirm with:
   ```sql
   SELECT count(*) AS total_holes,
          count(*) FILTER (WHERE fairway_hit IS NOT NULL) AS fairway_set,
          count(*) FILTER (WHERE gir IS NOT NULL)         AS gir_set
     FROM round_hole;
   ```
3. **Cross-tab dependency: Practice reads what Play wrote.** The Practice coach ranker reads round data through `computeScoringWeaknesses` (`round`/`round_hole`) via `GET /api/rounds/scoring-weaknesses` and `services/api/src/practice.ts` `loadCoachInputs` (per the practice inventory §3). **Retiring the Play *write* path (S2) must not retire the round *read* path** — the Practice coach and the future Stats/Plan surfaces depend on `round`/`round_hole` staying populated (now via the D22 sync). `rounds.ts` is SHARED (§1c note). This is the one genuine cross-tab coupling: kill the Play UI, keep the round data layer alive.
4. **`hole_feature` has no Play-tab consumer — its live readers are Plan + strategy.** (§4b.) A naive "delete everything Play" pass would *not* remove `hole_feature`; conversely dropping `hole_feature` in S2 would break the still-live Plan hole page + `/api/strategy` (Plan teardown is TBD, S7). Sequence the drop with the Plan pivot, or strip the two reads simultaneously.
5. **`/api/strategy` is shared by both retiring tabs.** Both `HoleView` (Play) and `StrategyPanel` (Plan) POST to it; `strategy.ts` reads `hole` + `hole_feature` + `club_dispersion`. It survives S2 (Plan still uses it) and only fully retires at the Plan pivot. Don't delete the strategy route/module in the Play teardown.
6. **Nav test is a hard CI gate.** `tests/bottom-nav.test.ts` asserts the exact 4-tab href/label arrays and `isActiveTab("/play/...","/play")`. S2's D20 reshape (`/courses`→Plan stays or moves? Stats at Play's slot) must edit the test in the same PR. Decide the Stats route (`/stats`) and whether Plan keeps `/courses` or moves — the test encodes both.
7. **Home-page icon gap.** Removing the book + flag cards (§1d) leaves only the `target` (Practice) glyph; the Stats card (D20) needs a **new** `EntryIcon` kind + a new `BottomNav` `TabIconGlyph` case (`"stats"` replacing `"play"` in the `TabIcon` union). Net-new SVG, small but not free.
8. **The Trackman note paragraph vs the button.** §7 — D21 removes the inert *button* (lines 640–648); the adjacent explanatory *note* (lines 539–541, the `trackman` type sub-copy) references "Import your screenshots via the Shot Logger skill." Decide in S2 whether the note copy stays (the skill still exists per D21) or goes.
9. **Fox Bend seed data location.** The course/hole/hole_feature seed is `services/api/src/migrations/002_fox_bend_seed.sql` (one CTE: 1 course, 18 holes, 29 features), corrected by `004_fox_bend_tee_columns.sql` (tee-column name-match, D-3B-1). Hole **images** live at `courses/fox-bend/images/Fox Bend Hole Images/hole-NN.PNG` (repo) and are served from `apps/web/public/courses/fox-bend/images/hole-NN.png` (both the Play `HoleView` and Plan hole page build `/courses/fox-bend/images/hole-{padded}.png`). The `002` seed is a **non-idempotent INSERT** (a fresh CTE insert, guarded only by being recorded in `_migrations`) — re-running it would duplicate Fox Bend, which is exactly why `004` exists as a separate corrective migration (see D-3B-1). Any S3 course-model change (adding `slug`, `tee_box`) must not re-seed Fox Bend; extend via ALTER + scoped UPDATE like `004` did.
10. **`round.tee_set` is free text, not FK'd to any tee table.** Today it's a bare `text DEFAULT 'white'` (§3e). D23/§3 adds `tee_box_id` (FK to the new `tee_box`). The migration must decide the fate of the legacy `tee_set` string (keep for back-compat vs backfill into `tee_box_id`); no code reads `tee_set` for logic today except `getRound` echoing it, so it's low-risk to leave or drop.

---

## Summary of load-bearing findings for S2–S4

1. **`services/api/src/rounds.ts` is SHARED — do not delete it in the Play teardown.** Retire the Play UI + the live-write routes (`/holes`, `/recap`, on-course `DELETE`/`PATCH`); keep `getRound`/`listRounds`/`summarizeRound`/`computeScoringWeaknesses`/`markRoundTest`, which Stats + the Practice coach + the D22 sync all need.
2. **`hole_feature`'s only live readers are Plan + `/api/strategy`, not Play.** Its drop belongs with the Plan pivot (S7), not S2 — or S2 must strip `strategy.ts:123` + the Plan hole page reads at the same time. Row count **PENDING VERIFICATION** (§4c; seed expectation 29).
3. **Round fields have almost no existing validation layers** — no DB CHECKs on `fairway_hit`/`gir`/`penalty_strokes`/`tee_set`. S3's `fairway_result`/`differential_source` CHECKs *add* a constraint layer; the new "three lists" are payload-schema (Claude) / sync-validator (server) / DB-CHECK — with **no client layer** (D21).
4. **The live flow never recorded fairways/GIR/direction** (§9.2) — the D22/D27 backfill is the only real source of that data; don't assume existing rounds have it.
5. **D22's sync mirrors the migration manifest exactly** (§8): a checked-in build-time generator wired to `apps/web` `prebuild` + a memoized, advisory-locked, ledger-keyed runtime runner that fails loudly. The discipline to clone already exists in `generate-migrations-manifest.mjs` + `db.ts`.
6. **`is_test` is filtered in exactly one query today** (`computeScoringWeaknesses`); all three Stats windows are net-new SQL that must each re-assert `is_test = false` (§6).
7. **Nav model + `tests/bottom-nav.test.ts` move together** (§1e, §9.6) — the D20 reshape is a lockstep edit or a CI failure.
