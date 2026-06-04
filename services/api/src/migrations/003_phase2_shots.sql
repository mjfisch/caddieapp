-- =============================================================
-- Phase 2 — Shots & per-club dispersion
-- shot       = raw launch-monitor rows (one per swing, Trackman et al.)
-- club_dispersion = one summary row per club, carrying the invariant #2
--                   confidence flag (measured | partial | seeded).
-- Numbers only, no PostGIS, no geometry (D9 / invariant). All idempotent.
-- =============================================================

CREATE TABLE IF NOT EXISTS shot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club text NOT NULL,
  carry_yards numeric NOT NULL,
  total_yards numeric,
  ball_speed_mph numeric,
  launch_angle_deg numeric,
  launch_dir_deg numeric,
  carry_side_yards numeric,
  session_date date,
  source text DEFAULT 'trackman',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS club_dispersion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club text NOT NULL UNIQUE,
  carry_mean_yards numeric NOT NULL,
  carry_sd_yards numeric NOT NULL,
  lateral_sd_yards numeric NOT NULL,
  shot_count int NOT NULL,
  confidence text NOT NULL CHECK (confidence IN ('measured','partial','seeded')),
  updated_at timestamptz DEFAULT now()
);

-- Recompute reads shots grouped by club; index keeps that cheap as the table grows.
CREATE INDEX IF NOT EXISTS shot_club_idx ON shot (club);
