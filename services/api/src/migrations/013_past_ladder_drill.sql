-- =============================================================
-- Mission S9 — seed the Past Ladder putting drill.
--
-- Lag Ladder is scored on 3-putts, which makes it blind to the pattern it was
-- meant to catch: a set can post a near-perfect number while 9 of 10 lags
-- finish short, because the score is really measuring the comeback putt. Past
-- Ladder replaces the SCORING, not the practice — pass = finishes past the hole
-- with a comeback of 4 ft or less; short of the hole is an automatic fail.
--
-- Lag Ladder itself is untouched apart from its sort_order: eleven logged
-- sessions reference it and that history must stay readable (§ drills are
-- archived, never deleted — session_drill_block.drill_id is ON DELETE RESTRICT).
--
-- Mirrors the 009 seed pattern exactly: INSERT … SELECT FROM (VALUES …) guarded
-- by NOT EXISTS on drill.title, metric defs guarded on (drill_id, label),
-- resource_url NULL + resource_kind 'drill' (no fabricated URL, invariant #4).
-- Idempotent: runs inside the applyMigrations() advisory-locked transaction
-- (services/api/src/db.ts), recorded once in _migrations. No BEGIN/COMMIT here
-- (the runner owns the transaction).
-- =============================================================

-- Step 1 — Reorder the existing putting drills FIRST, so the new row can take
-- sort_order 2 without a transient collision. General (is_system, sorts first
-- via `ORDER BY d.is_system DESC` in listPuttingDrills) keeps 0; Gate Drill
-- keeps 1. Absolute values, not increments — re-running is a no-op.
UPDATE drill SET sort_order = 3 WHERE area = 'putting' AND title = 'Lag Ladder';
UPDATE drill SET sort_order = 4 WHERE area = 'putting' AND title = 'Circle Drill';

-- Step 2 — the drill itself. Idempotent on title (the 009/006 guard).
INSERT INTO drill (area, title, description, resource_url, resource_kind, is_system, sort_order)
SELECT v.area, v.title, v.description, v.resource_url, v.resource_kind, v.is_system, v.sort_order
FROM (VALUES
  ('putting',
   'Past Ladder',
   'Lag from a fixed station (30 ft to start; move back to 45 after two sessions at Short <= 2). A ball passes only if it finishes PAST the hole with a comeback of 4 ft or less — short of the hole is an automatic fail no matter how close, and past the hole but outside 4 ft is a fail too. Mark the zone with two tees 4 ft past the hole, roughly 3 ft apart, never the flagstick: a stick stops the ball that would have run 9 ft past and turns the worst putt of the set into a near miss. Judge by the comeback left, not the tee line. Short + In zone + Long must equal Balls.',
   NULL, 'drill', false, 2)
) AS v(area, title, description, resource_url, resource_kind, is_system, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM drill d WHERE d.title = v.title);

-- Step 3 — metric defs, in display order. Idempotent on (drill_id, label);
-- resolves drill_id by title so it binds to the row above.
--
-- `better` is NULL on every metric, deliberately. The stats layer derives a
-- drill card from the metric def carrying `better` and SKIPS a drill whose defs
-- carry none ("unscored: nothing honest to plot", computePracticeStats.ts). This
-- mission seeds the drill only; Practice-stats handling for it is a separate
-- decision, and a guessed direction would start plotting it on deploy. Short is
-- obviously lower-is-better and In zone higher — setting them is a one-line
-- follow-up migration when the stats treatment is designed.
--
-- Long is recorded rather than derived (Balls - Short - In zone gives the same
-- number) so the entry is self-checking: with three buckets a miscount is
-- visible on the card, with two it is silent. 'Longest comeback' is named in
-- full because Long is a count and Longest is a distance.
INSERT INTO drill_metric_def (drill_id, label, value_type, unit, better, sort_order)
SELECT d.id, v.label, v.value_type, v.unit, v.better, v.sort_order
FROM (VALUES
  ('Past Ladder', 'Distance',          'integer', 'ft', NULL, 0),
  ('Past Ladder', 'Balls',             'integer', NULL, NULL, 1),
  ('Past Ladder', 'Short',             'integer', NULL, NULL, 2),
  ('Past Ladder', 'In zone',           'integer', NULL, NULL, 3),
  ('Past Ladder', 'Long',              'integer', NULL, NULL, 4),
  ('Past Ladder', 'Longest comeback',  'integer', 'ft', NULL, 5)
) AS v(drill_title, label, value_type, unit, better, sort_order)
JOIN drill d ON d.title = v.drill_title
WHERE NOT EXISTS (
  SELECT 1 FROM drill_metric_def dmd
  WHERE dmd.drill_id = d.id AND dmd.label = v.label
);

-- Step 4 — report the resulting putting block order (the SQL-native way to
-- surface a value from a migration; informational only, mirrors 009's NOTICEs).
DO $$
DECLARE order_txt text;
BEGIN
  SELECT string_agg(t.title, ', ' ORDER BY t.is_system DESC, t.sort_order NULLS LAST, t.title)
    INTO order_txt
    FROM drill t
   WHERE t.area = 'putting' AND t.archived = false;
  RAISE NOTICE '[013] putting block picker order: %', order_txt;
END $$;
