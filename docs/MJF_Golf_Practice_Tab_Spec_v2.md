# MJF Golf — Practice Tab Spec v2 (schema-reconciled)

*Target design for the Practice tab redesign of the app formerly scoped as GAI Caddie (`caddieapp-web.vercel.app`). This is the product spec for the app's new primary surface.*

*v2 change from v1: §6 reconciled against the **live Neon production schema** (dumped 2026-07-08). Table/column names now match reality; net-new work is separated from already-existing structure; the missed `club` entity is added; `drill` naming corrected. Design decisions (§1–§5, §7) are unchanged from v1 and remain locked.*

*Spec v2.0 — July 8, 2026.*

---

## 1. Design principles (settle future field debates against these)

1. **The note is the hero.** Free-text recap (`recap_md`) is the highest-value data in the system. Every session type carries it, large and prominent. Real usage showed structured metric fields going NULL while all signal lived in prose.
2. **Tap-structure survives; measurement-structure dies.** Structured fields are welcome when answering is a tap (which club, what shape, what lie). Fields requiring mid-session counting/computation (conversion %, makes-in-3-ft %) are banned — they get skipped and rot as NULLs.
3. **Blocks, not blobs.** A session is naturally a sequence of blocks (Michael's own notes are numbered lists). Putting formalizes this with drill blocks; range types approximate it with per-club notes.
4. **One interaction pattern everywhere.** Tag an entity (club or drill) with one tap; expand only to add detail (shape, metrics, note). A quick log must never be punished by the existence of optional depth.
5. **Derived ≠ measured.** LLM-derived tags/summaries from notes are a separate confidence class from measured launch-monitor data. They may inform Stats but never touch Bag dispersion numbers. (Core invariant: math in code, LLM narrates.)

---

## 2. Session types

Four types. **Spornia net removed** as a loggable type. **Short game splits into Around the Green and Putting.**

| Type (new `type` value) | Replaces | Character |
|---|---|---|
| `trackman` (unchanged) | — | Structured, feeds Bag dispersion via import (future) |
| `grass_range` (unchanged) | — | Feel-only, no LM data, outdoor context |
| `around_green` (NEW) | `short_game` (partial) | Chipping/pitching/flops/bunker |
| `putting` (NEW) | `short_game` (partial) | Drill-block structured, most metric-rich type |

**Confirmed legacy data (live counts, 2026-07-08):** `short_game` = 7, `trackman` = 2, `grass_range` = 1 (10 total). The migration adds `around_green` and `putting` as valid `type` values; the **7 `short_game` rows stay untouched and render read-only** as "Short game (legacy)". `trackman`/`grass_range` legacy rows render normally. No forced migration of the 7 — several mix chipping and putting and can't split cleanly.

---

## 3. Fields shared by all four types

Confirmed already present on `practice_session`: `date`, `type`, `location`, `surface`, `ball`, `duration_min`, `overall_rating`, `recap_md`, `created_at`. **No new session-level columns are needed for the shared set** — the big v2 finding: the shared form is already backed by real columns.

- **Date** (`date`, default today)
- **Duration** (`duration_min`)
- **Overall rating** (`overall_rating`, 1–5 stars)
- **Recap & Feels** (`recap_md`) — free text, always present, visually primary. Optional greyed placeholder scaffolding (*worked on / noticed / takeaway*). Hints only; never required.
- **Save session**

Removed from the input UI app-wide: the old generic Focus Areas chip row (backed by `practice_focus`) and the preset metric inputs (backed by `practice_metric`). Both tables **frozen, not dropped** (see §6).

---

## 4. Per-type specifications

*(Unchanged in intent from v1; only storage notes updated.)*

### 4a. Trackman Range (`trackman`)
Keep: `date`, `duration_min`, `location` (Facility), `surface`, `ball`, `overall_rating`, `recap_md`.

Changes:
- **Clubs Used** replaces Focus Areas: chip row listing the full bag from the new `club` table (§5a), in bag order. Multi-select → writes `session_club` rows.
- **Per-club detail (collapsed):** expanding a selected club chip opens **Primary shot shape** (single-select, one per club per session: `straight · draw · pull · hook · fade · push · slice`, optional) and a **club note** (optional free text).
- **Import Trackman screenshots** button: keep visible, marked not-yet-functional. Wiring it is its own future mission (§9) — a server-side pipeline, not a UI fix. Do not fake it client-side.

### 4b. Grass Range (`grass_range`)
Keep: `date`, `duration_min`, `location`, `surface` (prefill "Grass"), `overall_rating`, `recap_md`, feel-only banner. Wind/conditions can reuse recap or a `location`-adjacent field; **do not add a dedicated column unless the build finds it trivial** (no schema support today, low-value vs. recap).

Changes: identical Clubs Used + per-club shape/note treatment. No import button.

### 4c. Around the Green (`around_green`)
Keep: `date`, `duration_min`, `overall_rating`, `recap_md`.

Remove from UI: Area dropdown; Lag-in-3-ft %; Up & Down % (measurement-structure — banned by principle 2).

Add:
- **Clubs Used** — multi-select filtered to short-game-eligible clubs (7-iron through 64° LW), via `around_green_eligible` on the new `club` table (§5a). Writes `session_club` rows.
- **Lie Types** — multi-select: `tight · short rough · deep rough · bunker`.
- **Shot Types** — multi-select: `chipping · pitching · flops · bunker`.
- **Per-club note** — same collapsed expand pattern. **No shot-shape selector here** (full-swing concept).

"bunker" intentionally appears in both Lie Types and Shot Types (sand lie vs. explosion shot — different axes).

### 4d. Putting (`putting`)
A Putting session = shared fields (§3) + an ordered list of **drill blocks**.

- **Add block** → picker: **General** first, then active defined drills.
- **General block** — note only, no metrics. Built-in system drill; covers freeform lag work ("30–60 ft, coming up short").
- **Drill block** — the drill's metric inputs (from its metric definitions) + optional block note.
- Blocks **ordered** (read as 1, 2, 3…), reorderable, deletable; same drill may repeat. All metric values optional.

---

## 5. New entities (the build work)

### 5a. `club` — the canonical bag (NET-NEW; **v2 addition the v1 spec missed**)
There is **no club table today** — clubs exist only as free-text strings on `shot`, `club_confidence`, `club_dispersion`. The redesign's Clubs-Used chip rows need a source-of-truth roster, so create one.

```
club: id · name · sort_order (bag order) · around_green_eligible (bool) · archived (bool)
```
- Seed from Michael's actual bag (pull distinct club strings already in `club_dispersion` / `shot` as the starting list; confirm against the Bag reference file).
- Set `around_green_eligible = true` for 7-iron through 64° LW only.
- Existing free-text club strings stay as-is on `shot`/`club_dispersion`; `club.name` should match those strings so joins/filters line up. Reconcile naming during seed (small data-hygiene task; flag mismatches rather than guessing).
- Club Confidence panel (§7) moves to Bag tab and reads this roster + `club_confidence`.

### 5b. `session_club` (NET-NEW)
```
session_club: id · practice_session_id (fk) · club (text, matches club.name) · shot_shape (nullable enum) · note (nullable text)
```
One row per club tagged in a range/around-green session. `shot_shape` null for around-green.

### 5c. `drill` (EXTEND EXISTING — do not recreate)
Already exists with: `id · area · title · description · resource_url · resource_kind · level`. **Reconcile to these names — do NOT introduce `name`/`category`; use existing `title` and `area`.** Add only: `is_system` (bool, General=true), `archived` (bool), `sort_order` (int).

### 5d. `drill_metric_def` (NET-NEW)
```
drill_metric_def: id · drill_id (fk) · label · value_type (integer|decimal|percent) · unit (nullable, e.g. "ft") · better ('lower'|'higher'|null) · sort_order
```
No range type — single-value distances only (decided; Michael averages ranges). `value_type` immutable once any value references it.

### 5e. `session_drill_block` + `session_drill_value` (NET-NEW)
```
session_drill_block: id · practice_session_id (fk) · drill_id (fk) · position (int) · note (nullable)
session_drill_value: id · block_id (fk) · metric_def_id (fk) · value (numeric)
```

### Seeded drills (create in the migration; use existing `drill.title`/`area`, `area='putting'`)

**Gate Drill (MJF variant)** — 25 consecutive makes from 3 ft through a gate; grip cycle 2-hand ×5 → right-only ×5 → 2-hand ×5 → right-only ×5 → 2-hand ×5; any miss resets to zero. Metric: **Resets** (integer, better=lower).

**Lag Ladder** — lag from a chosen distance, every ball holed out, second putts always holed before advancing; makes deliberately not tracked. Metrics: **Distance** (integer, unit ft) · **Balls** (integer) · **3-putts** (integer, better=lower).

**Circle Drill** — ring of balls around a hole at a single set distance (average if varied). Metrics: **Distance** (integer, unit ft) · **Balls** (integer) · **Makes** (integer, better=higher).

**General** — `is_system=true`, no metric defs, note only.

---

## 6. Schema reconciliation summary (v1 assumption → live reality)

| Spec §6 (v1) assumed | Live schema reality | Migration action |
|---|---|---|
| a `club` table w/ `around_green_eligible` | **no club table exists** | CREATE `club` (§5a) + seed |
| recap field (abstract) | `practice_session.recap_md` exists | reuse; no change |
| shared fields net-new | all exist on `practice_session` | reuse; no new shared columns |
| `session_club` new | not present | CREATE (§5b) |
| `drill` extend w/ `name`,`category` | exists w/ `title`,`area` (+description, resource_url, resource_kind, level) | EXTEND: add `is_system`,`archived`,`sort_order`; keep `title`/`area` |
| `drill_metric_def` new | not present | CREATE (§5d) |
| `session_drill_block`/`_value` new | not present | CREATE (§5e) |
| lie/shot types on session | no support today | ADD `lie_types text[]`, `shot_types text[]` on `practice_session` (or child tables per repo convention) |
| `practice_focus` deprecate | exists (child: `practice_session_id`,`area`) | FREEZE — legacy focus tags render from it; no new writes |
| `practice_metric` deprecate | exists (`practice_session_id`,`kind`,`value`) | verify row count; if empty, no legacy to preserve; freeze regardless |
| `hole_feature` = dead vestige | exists w/ v1 course-feature cols (`kind`,`side`,`distance_from_tee`,`carry_to_clear`) | verify row count; leave untouched; removal needs its own decision-log entry |

Not touched by this redesign but noted for later: `round`/`round_hole` are already rich (fairways_hit/possible, gir, putts, per-hole booleans, penalty_strokes, `is_test` flag) — good for the future Stats/round-import spec. **`round_hole` has no directional-miss field** — add when the Stats spec is built (two-way-miss tracking).

---

## 7. UI relocations and removals
- **Club Confidence panel → Bag tab** (reads `club` roster + `club_confidence`). Small standalone mission.
- **Spornia net** removed from the logger; any historical Spornia sessions render as legacy.
- Old Focus Areas chips + preset metric inputs removed from all logging forms (tables frozen, not dropped).

---

## 8. Inventory status (Mission 1) — RESOLVED (DB half)
- ✅ Full live schema dumped and reconciled (§6).
- ✅ `practice_session.type` values: `short_game`=7, `trackman`=2, `grass_range`=1.
- ✅ Focus tags stored in `practice_focus` child table (`practice_session_id` → `area`).
- ⏳ `hole_feature` / `practice_metric` row counts — confirm during Migration prep (expected empty).
- ⏳ Save-session flow + Recent Sessions query — CODE TRACE still owed (run the code-only inventory in Claude Code; prompt below).

---

## 9. Explicitly out of scope (do not build now)
- **Trackman screenshot import pipeline** (button stays visible but inert) — own project: upload → server route → vision parse → `shot` rows → dispersion recompute → Bag update.
- **Stats tab** (Play-tab replacement) + round import — separate spec (uses the already-rich `round`/`round_hole`).
- **Plan tab** redesign — separate spec; consumes the §5 `drill` + `drill_metric_def` entities as-is.
- **LLM-derived tags from notes** — Phase 2 candidate; surfaced as *derived*, never `measured`.
- **Branding/rename to "MJF Golf"** — pending decision-log entry (supersedes D16 scope) + domain consolidation call.

---

## 10. Suggested mission sequence (vertical slices)
1. **Inventory — code half (read-only):** trace save-session flow + Recent Sessions query; confirm `hole_feature`/`practice_metric` counts. Report only. *(DB half already done via Neon export.)*
2. **Migration:** CREATE `club`(+seed), `session_club`, `drill_metric_def`, `session_drill_block`, `session_drill_value`; EXTEND `drill` (+is_system/archived/sort_order) and `practice_session` (+lie_types/shot_types); seed the 4 drills; add `type` values `around_green`/`putting`. Freeze `practice_focus`/`practice_metric`. Round-trip test.
3. **Drill Manager:** CRUD + archive + metric-def UI. Test: create a drill w/ 2 metrics, log against it.
4. **Putting logger:** block picker, General block, metric inputs, per-block notes, ordering. Test: recreate the Jul 8 session (Gate/resets · Lag 30 ft/10 balls/1 three-putt · Circle 10 ft/10 balls/5 makes) as three blocks.
5. **Range types:** Clubs Used + per-club shape/note on Trackman + Grass forms (reads `club` roster).
6. **Around the Green:** new form (club filter via `around_green_eligible`, lie types, shot types); remove Area/percent fields.
7. **Legacy render + type cleanup:** Spornia removal, `short_game` legacy label, Recent Sessions integrity across all 10 old rows.
8. **Club Confidence → Bag tab.**

Each mission: fresh session, narrow goal, explicit I/O, checkpoint commit, staged review before merge.

---

*End of Practice Tab Spec v2. Locked decisions (session types, drill model B, single-value distances, seeded drills, `drill` name reconciliation, the new `club` roster) require Michael's explicit sign-off + a decision-log entry to change.*
