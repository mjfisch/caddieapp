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

-- ── 2. tee_box — new reference table (design doc §3; D23) ──────────────────
-- Rating and slope live here for reference + payload validation ONLY — the
-- differential arrives pre-computed on every round payload and is never
-- computed in-app (D23). yardage is optional. course_id CASCADE matches the
-- hole ownership pattern: a course owns its tee boxes. No seed rows — tee
-- boxes are created by the S4 sync from round payloads.

CREATE TABLE IF NOT EXISTS tee_box (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  name      text NOT NULL,
  rating    numeric NOT NULL,
  slope     int NOT NULL,
  yardage   int
);

-- Read-path index (house convention: index the FKs the reads hit).
CREATE INDEX IF NOT EXISTS tee_box_course_idx ON tee_box (course_id);

-- ── 3. round — tee_box FK, differential, source, reflection, external_key ──

-- FK direction (the Mission 2 drill-FK lesson): a tee_box is a REFERENCE that
-- round history points back to, so round.tee_box_id is ON DELETE RESTRICT —
-- the DB refuses to delete a tee box that has logged rounds. Reference tables
-- never take round history down with them (and rounds are never deleted
-- anyway, D24). Nullable DELIBERATELY: the two existing is_test rounds
-- predate tee boxes; the S4 sync validator requires tee_box_id on every
-- imported round.
ALTER TABLE round
  ADD COLUMN IF NOT EXISTS tee_box_id uuid REFERENCES tee_box(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS round_tee_box_idx ON round (tee_box_id);

-- differential + differential_source + external_key follow the same sequence:
-- add NULLABLE → backfill existing rows → tighten to NOT NULL, so the
-- constraints land with every row already valid. reflection stays nullable.
ALTER TABLE round ADD COLUMN IF NOT EXISTS differential        numeric;
ALTER TABLE round ADD COLUMN IF NOT EXISTS differential_source text;
ALTER TABLE round ADD COLUMN IF NOT EXISTS reflection          text;
ALTER TABLE round ADD COLUMN IF NOT EXISTS external_key        text;

-- Backfill: the pre-S3 rows are the two live-flow test rounds (Jun 5 / Jun 13,
-- is_test = true, D18). They predate differentials and get 0 /
-- 'computed_adjusted' as explicit placeholders. The UPDATEs cover ALL null
-- rows — not just is_test — so SET NOT NULL below cannot trip on a stray
-- fixture row; any non-test row caught is reported first (flag, don't guess).
DO $$
DECLARE
  stray bigint;
BEGIN
  SELECT count(*) INTO stray FROM round WHERE differential IS NULL AND is_test = false;
  IF stray > 0 THEN
    RAISE NOTICE '[012] % non-test round(s) had no differential — backfilled with the 0 / computed_adjusted placeholders', stray;
  END IF;
END $$;

UPDATE round SET differential = 0 WHERE differential IS NULL;
UPDATE round SET differential_source = 'computed_adjusted' WHERE differential_source IS NULL;

-- CHECK layer 3 of the header's coupling; layers 1–2 are the payload schema
-- and the S4 sync validator. ADD CONSTRAINT validates existing rows — the
-- backfill above already made them legal.
ALTER TABLE round DROP CONSTRAINT IF EXISTS round_differential_source_check;
ALTER TABLE round ADD CONSTRAINT round_differential_source_check
  CHECK (differential_source IN ('cdga_posted','computed_adjusted'));

ALTER TABLE round ALTER COLUMN differential        SET NOT NULL;
ALTER TABLE round ALTER COLUMN differential_source SET NOT NULL;

-- external_key: the D22 sync idempotency key, canonically YYYY-MM-DD_course-slug.
-- Legacy rows get a synthetic key from their own date + course slug (the two
-- test rounds become 2026-06-05_fox-bend / 2026-06-13_fox-bend). Guards so the
-- UNIQUE index below can never fail the migration on stray rows: a slug-less
-- course falls back to a course-id fragment, and same-day-same-course
-- duplicates get a numeric suffix.
WITH keyed AS (
  SELECT r.id,
         to_char(r.played_date, 'YYYY-MM-DD') || '_'
           || COALESCE(c.slug, 'course-' || left(r.course_id::text, 8), 'unknown') AS base_key,
         row_number() OVER (
           PARTITION BY r.played_date, r.course_id
           ORDER BY r.created_at, r.id
         ) AS rn
    FROM round r
    LEFT JOIN course c ON c.id = r.course_id
   WHERE r.external_key IS NULL
)
UPDATE round
   SET external_key = keyed.base_key
         || CASE WHEN keyed.rn = 1 THEN '' ELSE '-' || keyed.rn::text END
  FROM keyed
 WHERE round.id = keyed.id;

CREATE UNIQUE INDEX IF NOT EXISTS round_external_key_key ON round (external_key);

ALTER TABLE round ALTER COLUMN external_key SET NOT NULL;
