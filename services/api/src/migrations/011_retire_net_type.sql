-- =============================================================
-- Mission 7 — retire Spornia ('net') from the practice_session type domain.
--
-- Tightens the CHECK to the four live types PLUS 'short_game': the 7 legacy
-- short_game rows must stay valid (legacy is LABEL-ONLY — they keep rendering
-- and stay deletable, per the logged decision). Only 'net' is dropped; it was
-- confirmed at ZERO rows (spec §2/§8 live counts, 2026-07-08), so no data can
-- be invalidated. New-session creation of either retired type is blocked one
-- layer up, in the server's SESSION_TYPES list (services/api/src/practice.ts).
--
-- Idempotent: runs inside the applyMigrations() advisory-locked transaction
-- (services/api/src/db.ts), recorded once in _migrations. No BEGIN/COMMIT here
-- (the runner owns the transaction).
-- =============================================================

DO $$
DECLARE
  net_count bigint;
BEGIN
  -- Pre-flight: ADD CONSTRAINT validates existing rows, so a stray 'net' row
  -- would fail this migration with a generic check-violation. Fail earlier and
  -- louder with the actual situation instead.
  SELECT count(*) INTO net_count FROM practice_session WHERE type = 'net';
  IF net_count > 0 THEN
    RAISE EXCEPTION '[011] % practice_session row(s) with type=''net'' exist — expected zero. Reconcile them (delete or retype) before retiring the value.', net_count;
  END IF;

  ALTER TABLE practice_session DROP CONSTRAINT IF EXISTS practice_session_type_check;
  ALTER TABLE practice_session
    ADD CONSTRAINT practice_session_type_check
    CHECK (type IN ('trackman','grass_range','short_game','around_green','putting'));
END $$;
