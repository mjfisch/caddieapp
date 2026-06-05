-- =============================================================
-- Phase 5 — Rounds schema (score backend + post-round recap)
--
-- The persistence layer for Mode B play: round → round_hole. localStorage stays
-- the source of truth for the ACTIVE round UI; these tables are where a finished
-- (or in-progress) round lands so the Recap can render it and the practice ranker
-- can read real scoring weaknesses (closing the Play → Recap → Practice loop).
--
-- Numbers and booleans only — no PostGIS, no geometry (D9 / invariant). Idempotent.
-- =============================================================

CREATE TABLE IF NOT EXISTS round (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid REFERENCES course(id) ON DELETE CASCADE,
  played_date date NOT NULL,
  tee_set text NOT NULL DEFAULT 'white',
  total_strokes int,
  total_putts int,
  fairways_hit int,
  fairways_possible int,
  gir int,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS round_hole (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid REFERENCES round(id) ON DELETE CASCADE,
  hole_number int NOT NULL,
  strokes int NOT NULL,
  putts int,
  fairway_hit boolean,
  gir boolean,
  penalty_strokes int DEFAULT 0,
  notes text,
  -- One row per (round, hole): the score-chip sync upserts on this pair, so a
  -- re-tap updates the existing row rather than duplicating it (Step 3 / test 2).
  UNIQUE (round_id, hole_number)
);

-- Read paths: a round's holes in order, and a course's rounds newest-first.
CREATE INDEX IF NOT EXISTS round_hole_round_idx ON round_hole (round_id);
CREATE INDEX IF NOT EXISTS round_course_date_idx ON round (course_id, played_date DESC);
