-- =============================================================
-- Phase 1 — Courses schema
-- course → hole → hole_feature. Numbers, not polygons (D9 / invariant:
-- no PostGIS, no GeoJSON). All idempotent so re-running is safe.
-- =============================================================

CREATE TABLE IF NOT EXISTS course (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  city text,
  state text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hole (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid REFERENCES course(id) ON DELETE CASCADE,
  number int NOT NULL,
  par int NOT NULL,
  stroke_index int,
  -- Tee yardages, named by tee color. Back-to-front: black > white > blue > red.
  -- A course need not use every tee (Fox Bend has no Blue tee → yardage_blue NULL).
  -- yardage_black added Phase 3B (D-3B-1); live DBs get it via migration 004.
  yardage_black int,
  yardage_white int,
  yardage_blue int,
  yardage_red int,
  notes text
);

CREATE TABLE IF NOT EXISTS hole_feature (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hole_id uuid REFERENCES hole(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('bunker','water','ob','tree_line','forced_carry','green_complex')),
  side text CHECK (side IN ('left','right','center','front','back')),
  distance_from_tee int,
  carry_to_clear int,
  note text
);
