-- =============================================================
-- Mission S3 — Stats foundation schema (design doc §3; D22–D24)
--
-- The storage model the Stats tab and the D22 data-as-code round sync stand
-- on: course.slug (the payload matching key), the new tee_box reference
-- table, round differential / differential_source / reflection / external_key
-- / tee_box_id, and directional fairway_result on round_hole (deprecating the
-- fairway_hit boolean).
--
-- VALIDATION-LAYER COUPLING (the "three lists" lesson, round edition — see
-- docs/DECISIONS.md D23): the CHECK constraints added here (differential_source,
-- fairway_result) are one layer of a three-layer contract that must move
-- together:
--   1. the Claude-side payload schema (the mjf-round-logger skill),
--   2. the S4 sync validator (server, services/api),
--   3. these DB CHECKs (mirrored by the server-side FAIRWAY_RESULTS /
--      DIFFERENTIAL_SOURCES lists in services/api/src/rounds.ts).
-- Widening or narrowing any list means changing all layers in one mission.
--
-- Numbers and text only — no PostGIS, no geometry (D9 / invariant). Runs once
-- inside the applyMigrations() advisory-locked transaction (services/api/src/
-- db.ts) and is recorded in _migrations; every statement is still guarded so a
-- manual/double apply is harmless. No BEGIN/COMMIT here (the runner owns the
-- transaction). Any failure THROWS and rolls back the whole file — never a
-- silent no-op.
-- =============================================================

-- ── 1. course.slug — the payload matching key (design doc §3) ─────────────
-- UNIQUE via index (nullable stays legal: pre-sync courses without a slug are
-- fine; the D22 sync matches payloads on slug and will set it when seeding).

ALTER TABLE course ADD COLUMN IF NOT EXISTS slug text;

CREATE UNIQUE INDEX IF NOT EXISTS course_slug_key ON course (slug);

-- Backfill the one existing course, scoped by the 002 seed's canonical name —
-- a no-op on every other row and on re-apply.
UPDATE course
   SET slug = 'fox-bend'
 WHERE name = 'Fox Bend Golf Course'
   AND slug IS NULL;
