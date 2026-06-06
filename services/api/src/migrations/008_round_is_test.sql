-- =============================================================
-- Mission 2 — Delete + is_test flag (resolves D-5-1)
--
-- Adds the `is_test` flag to a round so a REAL-but-not-representative round
-- (a test, a scramble, a casual nine) can be kept in the log yet EXCLUDED from
-- the global scoring-weakness signal (computeScoringWeaknesses). This is distinct
-- from delete: delete = logged by accident; is_test = keep the data, mute the signal.
--
-- Cascade note (verified, no change needed): round_hole.round_id and the two
-- practice-session children (practice_focus, practice_metric) were created with
-- ON DELETE CASCADE in 005/007, so deleting a round or a practice_session already
-- removes its child rows. This migration therefore only adds the flag.
--
-- Numbers and booleans only — no PostGIS, no geometry (D9 / invariant). Idempotent.
-- =============================================================

ALTER TABLE round ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
