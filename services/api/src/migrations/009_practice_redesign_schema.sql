-- =============================================================
-- Mission 2 — Practice tab redesign: schema + drill seed
--
-- Reconciles the DB to Practice Tab Spec v2 §5/§6. Net-new entities for the
-- Clubs-Used chip rows, the putting drill-block model, and around-the-green
-- lie/shot tagging; the four seeded putting drills; and the widened session
-- `type` domain (adds 'around_green','putting'; KEEPS 'short_game','net' legal
-- so the 10 existing rows stay valid and never get rejected or dropped).
--
-- Freezes (per §3/§6): practice_focus + practice_metric are LEFT UNTOUCHED here
-- (frozen, not dropped) — legacy focus tags still render from them. hole_feature
-- is likewise left untouched (its removal needs its own decision-log entry).
--
-- Numbers/text/arrays only — no PostGIS, no geometry (D9 / invariant). Idempotent:
-- runs inside the applyMigrations() advisory-locked transaction (services/api/
-- src/db.ts), recorded once in _migrations. No BEGIN/COMMIT here (the runner owns
-- the transaction).
-- =============================================================

-- Step 1 — Confirm the spec's "expected empty" assumption for the two tables the
-- redesign does NOT migrate. Emitted as NOTICEs (the SQL-native way to surface a
-- value from a migration). These are informational only: a non-zero count is not
-- an error — hole_feature stays untouched regardless, and a non-empty
-- practice_metric just means there is legacy to preserve (which the freeze does).
DO $$
DECLARE
  hf_count bigint;
  pm_count bigint;
BEGIN
  SELECT count(*) INTO hf_count FROM hole_feature;
  SELECT count(*) INTO pm_count FROM practice_metric;
  RAISE NOTICE '[009] hole_feature row count = % (spec expects 0)', hf_count;
  RAISE NOTICE '[009] practice_metric row count = % (spec expects 0)', pm_count;
END $$;

-- Step 5 — EXTEND drill (do NOT recreate; reuse existing title/area, no name/category).
-- Done before the drill seed below so the seed can set is_system/sort_order.
ALTER TABLE drill ADD COLUMN IF NOT EXISTS is_system  boolean NOT NULL DEFAULT false;
ALTER TABLE drill ADD COLUMN IF NOT EXISTS archived   boolean NOT NULL DEFAULT false;
ALTER TABLE drill ADD COLUMN IF NOT EXISTS sort_order int;

-- Step 6 — EXTEND practice_session with the around-the-green tag arrays. No
-- existing column or row is touched.
ALTER TABLE practice_session ADD COLUMN IF NOT EXISTS lie_types  text[];
ALTER TABLE practice_session ADD COLUMN IF NOT EXISTS shot_types text[];

-- Step 2 — Widen the type domain. The 005 constraint is an inline single-column
-- CHECK, auto-named practice_session_type_check. Drop-if-exists then re-add with
-- the widened list; all four legacy values stay valid. NOT converted to an enum.
DO $$
BEGIN
  ALTER TABLE practice_session DROP CONSTRAINT IF EXISTS practice_session_type_check;
  ALTER TABLE practice_session
    ADD CONSTRAINT practice_session_type_check
    CHECK (type IN ('trackman','grass_range','short_game','net','around_green','putting'));
END $$;

-- Step 3 — club: the canonical bag roster (§5a). Source of truth for WHICH clubs
-- is the real bag already in club_dispersion (DISTINCT club strings). sort_order
-- (bag order) and around_green_eligible come from the known bag mapping below —
-- eligible = true for 7-iron through the 64° LW only. Any club string in
-- club_dispersion NOT in the mapping is seeded with sort_order NULL /
-- around_green_eligible false and reported via NOTICE (flag, don't guess).
CREATE TABLE IF NOT EXISTS club (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL UNIQUE,
  sort_order            int,
  around_green_eligible boolean NOT NULL DEFAULT false,
  archived              boolean NOT NULL DEFAULT false
);

-- Seed from the real bag. LEFT JOIN the known bag map (name → bag order → eligible)
-- so an unexpected string still seeds (as unmapped) rather than being dropped.
INSERT INTO club (name, sort_order, around_green_eligible)
SELECT d.club, m.sort_order, COALESCE(m.eligible, false)
FROM (SELECT DISTINCT club FROM club_dispersion) d
LEFT JOIN (VALUES
  ('driver', 0,  false),
  ('3h',     1,  false),
  ('5h',     2,  false),
  ('4i',     3,  false),
  ('6i',     4,  false),
  ('7i',     5,  true),
  ('8i',     6,  true),
  ('9i',     7,  true),
  ('PW',     8,  true),
  ('GW50',   9,  true),
  ('SW54',   10, true),
  ('LW60',   11, true),
  ('LW64',   12, true)
) AS m(name, sort_order, eligible) ON m.name = d.club
WHERE NOT EXISTS (SELECT 1 FROM club c WHERE c.name = d.club);

-- Report any club_dispersion string the bag map didn't recognize (seeded as
-- unmapped: sort_order NULL, around_green_eligible false — reconcile by hand).
DO $$
DECLARE unmapped text;
BEGIN
  SELECT string_agg(d.club, ', ') INTO unmapped
  FROM (SELECT DISTINCT club FROM club_dispersion) d
  LEFT JOIN (VALUES
    ('driver'),('3h'),('5h'),('4i'),('6i'),('7i'),('8i'),('9i'),
    ('PW'),('GW50'),('SW54'),('LW60'),('LW64')
  ) AS m(name) ON m.name = d.club
  WHERE m.name IS NULL;
  IF unmapped IS NOT NULL THEN
    RAISE NOTICE '[009] club seed: UNMAPPED club_dispersion strings (sort_order NULL, around_green_eligible=false, reconcile by hand): %', unmapped;
  ELSE
    RAISE NOTICE '[009] club seed: all club_dispersion strings mapped to bag order + eligibility cleanly';
  END IF;
END $$;

-- Step 4 — the net-new session/drill entities (§5b/5d/5e). Ownership FKs CASCADE
-- (a session owns its session_club rows and drill blocks; a block owns its
-- values), matching the 005 pattern. But a REFERENCE to a drill is different: a
-- drill is a definition that session history points back to, and per §5 drills
-- are ARCHIVED (drill.archived), never hard-deleted. So session_drill_block.
-- drill_id is ON DELETE RESTRICT — the DB refuses to delete a drill that has
-- logged blocks, forcing archive-instead rather than silently taking history with
-- it. (drill_metric_def.drill_id stays CASCADE: a metric def is owned by its
-- drill, not history pointing at it.)

-- §5b — one row per club tagged in a range / around-green session.
-- shot_shape is null for around-green (full-swing concept, per §4c).
CREATE TABLE IF NOT EXISTS session_club (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_session_id uuid NOT NULL REFERENCES practice_session(id) ON DELETE CASCADE,
  club                text NOT NULL,  -- matches club.name (join-by-text per §5a)
  shot_shape          text CHECK (shot_shape IN ('straight','draw','pull','hook','fade','push','slice')),
  note                text
);

-- §5d — a drill's metric definitions. value_type is immutable once any value
-- references it (enforced by convention / app layer, per §5d). No range type —
-- single-value distances only.
CREATE TABLE IF NOT EXISTS drill_metric_def (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drill_id   uuid NOT NULL REFERENCES drill(id) ON DELETE CASCADE,
  label      text NOT NULL,
  value_type text NOT NULL CHECK (value_type IN ('integer','decimal','percent')),
  unit       text,
  better     text CHECK (better IN ('lower','higher')),
  sort_order int
);

-- §5e — a putting session's ordered drill blocks, and the metric values in each.
CREATE TABLE IF NOT EXISTS session_drill_block (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_session_id uuid NOT NULL REFERENCES practice_session(id) ON DELETE CASCADE,
  drill_id            uuid NOT NULL REFERENCES drill(id) ON DELETE RESTRICT,
  position            int NOT NULL,
  note                text
);

CREATE TABLE IF NOT EXISTS session_drill_value (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id      uuid NOT NULL REFERENCES session_drill_block(id) ON DELETE CASCADE,
  metric_def_id uuid NOT NULL REFERENCES drill_metric_def(id) ON DELETE CASCADE,
  value         numeric NOT NULL
);

-- Read-path indexes (mirror the 005 convention: index the FKs the reads hit).
CREATE INDEX IF NOT EXISTS session_club_session_idx        ON session_club (practice_session_id);
CREATE INDEX IF NOT EXISTS drill_metric_def_drill_idx      ON drill_metric_def (drill_id);
CREATE INDEX IF NOT EXISTS session_drill_block_session_idx ON session_drill_block (practice_session_id);
CREATE INDEX IF NOT EXISTS session_drill_value_block_idx   ON session_drill_value (block_id);

-- Step 7 — seed the four putting drills (§5, area='putting'). Reuse existing
-- drill.title/area. resource_url NULL + resource_kind 'drill' (no fabricated URL,
-- invariant #4). Idempotent on title (matches the 006 seed pattern). General is
-- the built-in system drill (is_system=true, no metric defs, note only) and sorts
-- first in the block picker (§4d).
INSERT INTO drill (area, title, description, resource_url, resource_kind, is_system, sort_order)
SELECT v.area, v.title, v.description, v.resource_url, v.resource_kind, v.is_system, v.sort_order
FROM (VALUES
  ('putting',
   'General',
   'Freeform putting work — lag, speed, whatever the session calls for. No metrics; the note carries the signal (e.g. "30–60 ft, coming up short"). Built-in system block.',
   NULL, 'drill', true, 0),
  ('putting',
   'Gate Drill (MJF variant)',
   '25 consecutive makes from 3 ft through a gate. Grip cycle: 2-hand ×5 → right-only ×5 → 2-hand ×5 → right-only ×5 → 2-hand ×5. Any miss resets the count to zero. Track how many times you reset.',
   NULL, 'drill', false, 1),
  ('putting',
   'Lag Ladder',
   'Lag from a chosen distance; every ball is holed out, and second putts are always holed before advancing. Makes are deliberately not tracked — this is a speed/lag drill. Track distance, balls, and three-putts.',
   NULL, 'drill', false, 2),
  ('putting',
   'Circle Drill',
   'A ring of balls around a hole at a single set distance (average the distance if it varies). Track distance, how many balls, and how many you made.',
   NULL, 'drill', false, 3)
) AS v(area, title, description, resource_url, resource_kind, is_system, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM drill d WHERE d.title = v.title);

-- Metric defs for the three metric-bearing drills (General has none). Idempotent
-- on (drill_id, label). Resolves drill_id by title so it binds to the rows above.
INSERT INTO drill_metric_def (drill_id, label, value_type, unit, better, sort_order)
SELECT d.id, v.label, v.value_type, v.unit, v.better, v.sort_order
FROM (VALUES
  -- Gate Drill (MJF variant)
  ('Gate Drill (MJF variant)', 'Resets',   'integer', NULL, 'lower',  0),
  -- Lag Ladder
  ('Lag Ladder',               'Distance', 'integer', 'ft',  NULL,    0),
  ('Lag Ladder',               'Balls',    'integer', NULL,  NULL,    1),
  ('Lag Ladder',               '3-putts',  'integer', NULL,  'lower',  2),
  -- Circle Drill
  ('Circle Drill',             'Distance', 'integer', 'ft',  NULL,    0),
  ('Circle Drill',             'Balls',    'integer', NULL,  NULL,    1),
  ('Circle Drill',             'Makes',    'integer', NULL,  'higher', 2)
) AS v(drill_title, label, value_type, unit, better, sort_order)
JOIN drill d ON d.title = v.drill_title
WHERE NOT EXISTS (
  SELECT 1 FROM drill_metric_def dmd
  WHERE dmd.drill_id = d.id AND dmd.label = v.label
);
