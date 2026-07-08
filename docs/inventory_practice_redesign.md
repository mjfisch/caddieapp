# Practice Tab Redesign — Mission 1 Code Trace

*Companion to `MJF_Golf_Practice_Tab_Spec_v2.md` §8 (DB half already resolved via Neon export). This is the code-only half of the inventory: READ-ONLY, no code changes. Traces the save-session flow, Recent Sessions rendering, `practice_focus`/`practice_metric` usage, and where per-type form fields live.*

*Trace date: 2026-07-08. Branch: `claude/practice-tab-code-trace-hd2qku`.*

---

## 1. Save-session flow

**Client handler:** `apps/web/src/app/practice/page.tsx`
- `saveSession()` (lines 298–373) builds the POST body from client state and per-type branches (`trackman` / `grass_range` / `short_game` / `net`).
- Calls `POST /api/practice/sessions` (line 355).
- Delete: `deleteSession(id)` (lines 378–396) calls `DELETE /api/practice/sessions/${id}`.

**API route:** `apps/web/src/app/api/practice/sessions/route.ts`
- `POST` (lines 30–49): parses JSON, calls `runMigrations()`, then `createPracticeSession(body)` from `@gai/api` (re-exported from `services/api/src/practice.ts`). Maps `PracticeError` → its `.status`, else 500.
- `GET` (lines 15–24): `runMigrations()` then `listPracticeSessions()`.
- Delete route: `apps/web/src/app/api/practice/sessions/[id]/route.ts` → `deletePracticeSession(id)`.

**Actual write targets** (`services/api/src/practice.ts`, `createPracticeSession`, lines 96–171) — **one transaction**:
1. `INSERT INTO practice_session (date, type, location, surface, ball, duration_min, overall_rating, recap_md, linked_shot_session)` — one row per session.
2. `INSERT INTO practice_focus (practice_session_id, area)` — one row per focus-area tag in `input.focusAreas`.
3. `INSERT INTO practice_metric (practice_session_id, kind, value)` — one row per metric in `input.metrics`.

`practice_session` id is a Postgres `gen_random_uuid()`; both child inserts are looped, not batched, inside the same `BEGIN`/`COMMIT`.

### How `type` is set and validated — **three independent lists, not one enum**

This is the load-bearing finding for Mission 2. `type` is constrained in three separate places that must all change together, or the write path breaks in different ways depending on which layer is stale:

| Layer | Location | Current values | Failure mode if stale |
|---|---|---|---|
| DB CHECK constraint | `services/api/src/migrations/005_phase45_practice.sql:19` — `CHECK (type IN ('trackman','grass_range','short_game','net'))` | 4 values | INSERT throws a Postgres constraint-violation error (surfaces as an unhandled 500, not a clean `PracticeError`) |
| Server validation array | `services/api/src/practice.ts:72` — `const SESSION_TYPES = ["trackman","grass_range","short_game","net"] as const;` | 4 values | `createPracticeSession` throws `PracticeError(400, ...)` **before** ever reaching the DB — this is the one that actually fires first today |
| Client picker + label map | `apps/web/src/app/practice/page.tsx:46–52` (`SESSION_TYPES` array, feeds the type-picker buttons) and `:79–84` (`TYPE_LABEL`, feeds Recent Sessions display) | 4 values, **hardcoded strings**, not fetched from anywhere | New types simply can't be selected in the UI; old type labels render as raw `s.type` string if missing from the map |

None of the three is generated from another — they're independently maintained string lists. Mission 2 (migration) touches only the first; Missions 4–6 (form rewrites) must touch the second and third by hand, in the same PR, or the app will validate-reject or DB-reject a session type the UI just started offering.

**Also worth flagging:** the DB CHECK constraint is a plain `CHECK (type IN (...))`, not a Postgres enum type, so adding `around_green`/`putting` is a straightforward `ALTER TABLE practice_session DROP CONSTRAINT ... ADD CONSTRAINT ... CHECK (type IN (...))` in a new numbered migration (`009_...sql`, following the existing `NNN_description.sql` convention read/applied by `services/api/src/db.ts`'s `applyMigrations()` — an idempotent, advisory-lock-guarded runner keyed off a `_migrations` tracking table). Spec §10 mission 2 doesn't call this constraint out explicitly; it's simple but must not be forgotten, since a bare `INSERT` of `type='putting'` will fail loudly against the current constraint.

**Also worth flagging — "net" (Spornia) is not just legacy, it's live:** the spec's confirmed legacy counts (§2, §8) are `short_game=7, trackman=2, grass_range=1` — no `net` rows exist in the DB. But the client picker (`page.tsx:46–51`) and the server's validation array both still actively accept `net` as a session type *today*. Spec §7 says "Spornia net removed from the logger," but that removal isn't a legacy-rendering problem (there's no data) — it's simply deleting the option from all three lists above and from the type-specific form branch (`page.tsx:638–666`, `clubsWorked`/`reps`/`swingThought` state). Whichever mission handles §7 should do this cleanup; it's not automatically covered by the around_green/putting migration work.

---

## 2. Recent Sessions query

**Fetch:** `apps/web/src/app/practice/page.tsx` → `loadSessions()` (lines 207–216) calls `GET /api/practice/sessions` on mount, populates `sessions` state.

**Server query:** `listPracticeSessions()` in `services/api/src/practice.ts` (lines 188–226):
```sql
SELECT s.id, to_char(s.date,'YYYY-MM-DD') AS date, s.type, s.location, s.surface,
       s.ball, s.duration_min, s.overall_rating, s.recap_md, s.linked_shot_session,
       COALESCE(array_remove(array_agg(f.area ORDER BY f.area), NULL), '{}') AS focus_areas
  FROM practice_session s
  LEFT JOIN practice_focus f ON f.practice_session_id = s.id
 GROUP BY s.id
 ORDER BY s.date DESC, s.created_at DESC
```
This is a **flat, type-agnostic query** — it does not branch on `type` at all, and doesn't touch `practice_metric` (metrics are write-only from the list's perspective; nothing reads them back for display today). Any `type` value that exists in the DB round-trips through this query with zero special-casing.

**Rendering:** same file, lines 779–854 (session-history JSX). Per-row rendering only touches:
- `TYPE_LABEL[s.type] ?? s.type` (line 801, 801) — the **only** place a `type` value maps to a display label, and it falls back to the raw string if missing from the hardcoded map.
- `s.focusAreas.join(" · ")` (line 810) — generic, not type-specific.
- `s.recap_md` clipped/expanded (lines 812–814) — generic.
- No per-type conditional rendering exists in Recent Sessions at all today (unlike the input form, which branches heavily by `type`).

**What legacy handling actually requires:** because the query and the rendering are both type-agnostic already, the 7 `short_game` rows need exactly **one** change to keep displaying correctly: add `short_game: "Short game (legacy)"` to the `TYPE_LABEL` map (`page.tsx:79–84`) once `short_game` stops being a selectable input type. No query change, no join change, no schema read-only flag needed — `TYPE_LABEL` is purely cosmetic and doesn't gate editability. (Spec §2 says these rows should render "read-only" — there is currently no read-only/disabled state in the session-history UI at all; every row shows a Delete button regardless of type. If "read-only" means more than a label — e.g., suppressing the Delete button for legacy `short_game` rows — that's new conditional logic Missions 4–7 will need to add, since nothing like it exists today to reuse.) `trackman`/`grass_range` rows need no changes since those types are `unchanged` per spec §2.

---

## 3. `practice_focus` / `practice_metric` — every code path that touches them

Both tables are used **only** in the write/read/delete paths already covered above — there is no other consumer anywhere in the repo (confirmed via repo-wide grep across `apps/`, `services/`, `packages/`, `tests/`).

**Writes** — `createPracticeSession`, `services/api/src/practice.ts:141–157`: one `INSERT` per tag/metric, looped, inside the session's transaction. Client-side sources:
- `focusAreas`: built in `saveSession()` (`page.tsx:303, 319–326, 336`) from the `focus` chip-selection Set (`FOCUS_OPTIONS`, lines 54–62) plus a per-type auto-tag for `short_game` (`sgArea` → `tagByArea` lookup, lines 319–326).
- `metrics`: built the same function — `short_game` contributes `lag_in_3ft`/`up_and_down` (lines 327–330), `net` contributes `reps` (lines 333–334). `trackman`/`grass_range` never populate `metrics`.

**Reads:**
- `listPracticeSessions()` (`services/api/src/practice.ts:205–224`) — `LEFT JOIN practice_focus`, aggregates `area` into `focusAreas` array for session-history display (§2 above). **`practice_metric` is never read back** anywhere in the app — it's a write-only sink today. (Confirmed: no `SELECT ... FROM practice_metric` outside the deletion-cascade test.)
- The AI coach pipeline (`loadCoachInputs`, `services/api/src/practice.ts:337–378`) does **not** read `practice_focus` or `practice_metric` at all — it reads `club_dispersion`, `club_confidence`, and `computeScoringWeaknesses()` (from `round`/`round_hole`). Focus tags and metrics have no influence on the coach today, despite living adjacent to it in the same file.
- `apps/web/src/app/practice/page.tsx` client-side: the `?focus=` deep-link handler (lines 179–194, fed by `FOCUS_FROM_PARAM`, lines 66–71) pre-selects a focus chip from a Recap "Take to Practice →" link — this reads/writes only the client-side `focus` Set, not the DB directly (it flows into the next `saveSession()` call's `focusAreas`).

**Delete (cascade):** `deletePracticeSession()` (`services/api/src/practice.ts:236–255`) does a bare `DELETE FROM practice_session WHERE id = $1`; child-row cleanup relies entirely on `ON DELETE CASCADE` declared on both FKs in the migration (`005_phase45_practice.sql:32, 46`), not on explicit code. Verified by `tests/round-deletion.test.ts:152–162`, which asserts both tables go to zero rows after a session delete (that test's name is misleading — it exercises practice-session cascade, not round deletion, in those specific lines).

**Net effect for the freeze (spec §3, §6):** since `practice_focus` is read in exactly one place (`listPracticeSessions`, for display) and written in exactly one place (`createPracticeSession`, from the focus chip UI), "freeze" per spec means: stop writing new rows (remove the Focus Areas chip UI + the `short_game`/`net` auto-tag branches from `saveSession()`), but the `listPracticeSessions` join must stay — it's what makes legacy sessions' old focus tags keep rendering. `practice_metric` is simpler to freeze: it's write-only already, so freezing is just removing the two metric-producing UI branches (`lagIn3ft`/`upDown` for `short_game`, `reps` for `net`); no read path exists to preserve.

---

## 4. Where per-type form fields live

**There is no `FORMS` object or table-driven field registry.** All four session types' input fields are hand-written, inline JSX blocks inside a single component, `apps/web/src/app/practice/page.tsx`:

- Type picker + copy: `SESSION_TYPES` const (lines 46–52) — id/label/sub/feeds tuples driving the 4 picker buttons (lines 512–528) and the per-type note paragraphs (lines 531–554).
- Type-specific field state: individual `useState` calls, lines 151–161 (`facility`, `surface`, `ball`, `location`, `conditions`, `sgArea`, `lagIn3ft`, `upDown`, `clubsWorked`, `reps`, `swingThought`) — one state variable per field, not grouped by type.
- Type-specific field JSX, each its own `{type === "..." && (...)}` block:
  - `trackman`: lines 583–598 (facility/surface/ball) + import-bridge block, lines 669–676.
  - `grass_range`: lines 599–614 (location/surface-locked-to-Grass/conditions).
  - `short_game`: lines 615–637 (area `<select>`, lag-in-3ft, up-and-down — **both banned by spec §4c/principle 2**).
  - `net`: lines 638–666 (clubs-worked chips, reps, swing thought — **entire type removed by spec §7**).
- Universal fields (all types): date/duration grid (lines 556–580), rating stars (679–694), Focus Areas chips (696–713, **removed app-wide by spec §3**), recap textarea (715–724), save button (726–730).
- Reset-on-save: `resetForm()` (lines 280–296) individually clears every field across all four types — this function alone touches all type-specific state, so it's the one place a rewrite must track every renamed/removed/added field.

**Consequence for Missions 4–6:** because fields are per-type inline blocks with individually-declared state (not a data-driven `FORMS[type] → fields[]` config), "rewriting the form" for `around_green`/`putting`/`trackman`/`grass_range` means adding new `{type === "..." && (...)}` JSX blocks plus matching `useState` declarations and matching branches in both `saveSession()` (request-body assembly) and `resetForm()` (clearing) — there's no single object to edit; four-plus call sites move together for every field change. This is a real design gap relative to what the spec's per-type field tables (§4a–4d) seem to assume is a swappable config; it is not a blocker, but it means the "rewrite" is a bigger, more error-prone diff than a config change would be, and per-club expand/collapse (needed for `session_club` shape+note per §5b, §4a/4b/4c) has **zero existing precedent** in this file — the current form has no concept of "select a club chip, then expand it for detail," only flat chip toggles (`clubsWorked`, `net`-only) or a single `<select>` (`short_game`'s `sgArea`). That interaction pattern (spec principle 4, §4a/4c "collapsed expand") must be built from scratch, not adapted from something already there.

---

## Summary of hard/impossible-looking spec items surfaced by this trace

1. **§4d Putting drill blocks / §4a-c per-club collapsed expand-to-detail UI have no existing precedent** in `page.tsx` — today's form is flat toggles/selects only, no "tap to tag, expand for detail" pattern anywhere to reuse; this is new interaction design, not a data-shape change.
2. **`type` is validated in three independent hardcoded lists** (DB CHECK, server array, client array+label map) with no single source of truth — Missions 2/4-6 must edit all three in lockstep or get a 400 (server-stale) or a raw Postgres constraint error (DB-stale) instead of the new types working.
3. **"Spornia net" is live in the current build, not dormant** — the picker, validation, and a full form branch all still accept `net` even though zero rows exist; removing it (§7) is an active deletion task across 3+ files, not something that falls out of the around_green/putting migration for free.
4. **No `FORMS` config object exists** — per-type fields are hand-duplicated across state, JSX, `saveSession()`, and `resetForm()`; every field-set change touches 4 call sites, so Missions 4-6 are larger, more error-prone diffs than a table-driven form would require.
5. **Spec's "read-only" legacy rendering (§2) has no existing mechanism** — Recent Sessions has no disabled/read-only state today (every row gets a Delete button); a `TYPE_LABEL` entry alone gets the *label* right but doesn't make the row actually read-only if that's meant literally.
