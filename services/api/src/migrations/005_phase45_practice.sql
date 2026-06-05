-- =============================================================
-- Phase 4.5 — Practice tab (D12–D15)
--
-- The input side of the loop: this is the only surface that WRITES back to the
-- engine's inputs. Six tables, per spec §5:
--   practice_session        — one logged session (4 types: trackman|grass_range|short_game|net)
--   practice_focus          — focus-area tags for a session (driver, lag_putting, 4i_path…)
--   club_confidence         — the FEEL axis (1–4), distinct from club_dispersion.confidence (D13)
--   practice_metric         — optional light metrics (lag_in_3ft, up_and_downs…)
--   drill                   — curated drill library; vetted URLs only (D15 / invariant #4)
--   practice_recommendation — an auditable coach suggestion (source_signal records the trigger)
--
-- Numbers and text only — no PostGIS, no geometry (D9 / invariant). All idempotent.
-- =============================================================

CREATE TABLE IF NOT EXISTS practice_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  type text NOT NULL CHECK (type IN ('trackman','grass_range','short_game','net')),
  location text,
  surface text,
  ball text,
  duration_min int,
  overall_rating int CHECK (overall_rating BETWEEN 1 AND 5),
  recap_md text,
  linked_shot_session text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS practice_focus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_session_id uuid REFERENCES practice_session(id) ON DELETE CASCADE,
  area text NOT NULL
);

CREATE TABLE IF NOT EXISTS club_confidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club text NOT NULL UNIQUE,
  feel_level int NOT NULL CHECK (feel_level BETWEEN 1 AND 4),
  note text,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS practice_metric (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_session_id uuid REFERENCES practice_session(id) ON DELETE CASCADE,
  kind text NOT NULL,
  value numeric NOT NULL
);

CREATE TABLE IF NOT EXISTS drill (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area text NOT NULL,
  title text NOT NULL,
  description text,
  resource_url text,
  resource_kind text CHECK (resource_kind IN ('article','video','drill')),
  level text CHECK (level IN ('beginner','intermediate','advanced'))
);

CREATE TABLE IF NOT EXISTS practice_recommendation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  focus_area text NOT NULL,
  drill_id uuid REFERENCES drill(id),
  rationale text,
  source_signal text NOT NULL,
  status text DEFAULT 'active' CHECK (status IN ('active','dismissed','completed')),
  created_at timestamptz DEFAULT now()
);

-- The two foreign keys the read paths hit most: a session's focus tags and its metrics.
CREATE INDEX IF NOT EXISTS practice_focus_session_idx ON practice_focus (practice_session_id);
CREATE INDEX IF NOT EXISTS practice_metric_session_idx ON practice_metric (practice_session_id);
-- Sessions list newest-first; drills are looked up by area for the coach.
CREATE INDEX IF NOT EXISTS practice_session_date_idx ON practice_session (date DESC);
CREATE INDEX IF NOT EXISTS drill_area_idx ON drill (area);
