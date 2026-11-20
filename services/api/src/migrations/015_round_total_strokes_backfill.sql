-- =============================================================
-- Backfill round.total_strokes from round_hole.strokes.
--
-- round.total_strokes (007) was never written: every reader summed
-- round_hole.strokes itself, so the column is NULL on every round. From this
-- change on, both writers set it (roundSync.importRound on insert,
-- rounds.upsertRoundHole on every hole save, via computeTotalStrokes in
-- services/api/src/rounds.ts). This migration fills the existing rows.
--
-- Same rule as computeTotalStrokes (move them together): a total ONLY for a
-- complete card — exactly 18 round_hole rows, hole numbers 1–18, every row with
-- a non-null strokes value. round_hole is UNIQUE (round_id, hole_number) (007),
-- so 18 in-range rows means 18 distinct holes; strokes is NOT NULL (007), so the
-- COUNT(strokes) guard is belt-and-suspenders. A partial round stays NULL.
--
-- Idempotent: touches only rows where total_strokes IS NULL, so a re-run (or a
-- run after the writers have already set it) is a no-op. Runs inside the
-- applyMigrations() advisory-locked transaction; no BEGIN/COMMIT here.
-- =============================================================

UPDATE round r
   SET total_strokes = t.total
  FROM (
    SELECT rh.round_id, SUM(rh.strokes)::int AS total
      FROM round_hole rh
     GROUP BY rh.round_id
    HAVING COUNT(*) = 18
       AND COUNT(rh.strokes) = 18
       AND COUNT(*) FILTER (WHERE rh.hole_number BETWEEN 1 AND 18) = 18
  ) AS t
 WHERE r.id = t.round_id
   AND r.total_strokes IS NULL;
