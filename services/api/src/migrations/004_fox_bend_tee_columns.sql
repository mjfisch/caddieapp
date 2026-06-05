-- =============================================================
-- Phase 3B — Fox Bend tee-column correction (D-3B-1)
--
-- The original 002 seed loaded the back (Black) tee into yardage_white and the
-- White tee into yardage_blue — column names swapped relative to schema intent.
-- This migration corrects EXISTING data on already-seeded DBs (e.g. live Neon),
-- where 001/002 are already recorded in _migrations and will not re-run.
--
-- Design: add yardage_black (no-op where 001 already defines it) and rewrite the
-- four tee columns with EXPLICIT canonical values — not a positional swap — so it
-- is safe to apply regardless of current layout and is a true no-op on a fresh DB
-- seeded by the corrected 002. Scoped to Fox Bend; idempotent.
--
-- Name-matched mapping: Black→yardage_black, White→yardage_white,
-- Gray→yardage_red, and yardage_blue→NULL (Fox Bend has no Blue tee).
-- =============================================================

ALTER TABLE hole ADD COLUMN IF NOT EXISTS yardage_black int;

UPDATE hole AS h SET
  yardage_black = v.black,
  yardage_white = v.white,
  yardage_blue  = NULL,
  yardage_red   = v.gray
FROM (VALUES
  (1,  535, 496, 448),
  (2,  395, 370, 335),
  (3,  165, 150, 130),
  (4,  430, 400, 360),
  (5,  410, 385, 345),
  (6,  175, 160, 140),
  (7,  405, 375, 340),
  (8,  295, 270, 245),
  (9,  565, 530, 480),
  (10, 385, 360, 325),
  (11, 200, 180, 160),
  (12, 395, 370, 335),
  (13, 455, 425, 385),
  (14, 495, 460, 415),
  (15, 205, 185, 165),
  (16, 540, 505, 455),
  (17, 435, 405, 365),
  (18, 440, 410, 370)
) AS v(number, black, white, gray)
WHERE h.number = v.number
  AND h.course_id = (SELECT id FROM course WHERE name = 'Fox Bend Golf Course');
