-- =============================================================
-- Phase 4.5 — Curated drill library seed (D15 / invariant #4)
--
-- THE NO-HALLUCINATED-URL RULE. This is the coach's version of "the LLM never
-- does math": the model never invents a resource link — links come only from
-- THIS table. Per the build rule, a `resource_url` is populated ONLY when it is a
-- real, vetted, durable URL. Where a specific article/video URL cannot be
-- verified as live and current, the honest fallback is used: resource_url = NULL
-- and resource_kind = 'drill' (description-only). Every drill below is
-- description-only for that reason — a real, coachable drill with no fabricated
-- link. Invariant #4 cannot be violated by a NULL.
--
-- Coverage: 6 areas × 2 drills = 12 total. Areas match the signal ranker's
-- `area` vocabulary (driver, lag_putting, chipping, bunker, 4i_path, short_irons).
--
-- Idempotent: each row inserts only when no drill with that title exists yet.
-- =============================================================

INSERT INTO drill (area, title, description, resource_url, resource_kind, level)
SELECT v.area, v.title, v.description, v.resource_url, v.resource_kind, v.level
FROM (VALUES
  -- ── driver ──────────────────────────────────────────────────────────────
  ('driver',
   'Tee-bay sample: 12+ drivers, one ball, one target',
   'Hit at least 12 full drivers at a single target with the launch monitor on, no rehearsal swings between them. The point is a stable sample, not a highlight reel — dispersion only means something once N is large enough. This is the session that flips the driver from partial to measured.',
   NULL, 'drill', 'intermediate'),
  ('driver',
   'Start-line gate off the tee',
   'Set two alignment sticks a club-length apart, ~8 feet ahead, framing your intended start line. Hit drivers through the gate. Trains the left-miss out by making start direction visible — your feared pull/snap-hook shows up as a clipped left stick before it ever becomes a penalty.',
   NULL, 'drill', 'intermediate'),
  -- ── lag_putting ─────────────────────────────────────────────────────────
  ('lag_putting',
   '30-foot ladder, stop inside 3 feet',
   'Roll putts to 30, 40, and 50 feet; success is finishing inside a 3-foot circle, not holing out. Cue speed a touch PAST the hole — your lag miss is chronically short, and short is what becomes the three-putt. Ten balls, before you pull an iron, while willpower is high.',
   NULL, 'drill', 'beginner'),
  ('lag_putting',
   'Clock-face speed control (no hole)',
   'Putt to a tee, not a cup, from 15/30/45 feet. Removing the hole forces a pure speed focus and kills the steer. Five from each station; track how many finish past vs short — the goal is a slight bias to past.',
   NULL, 'drill', 'beginner'),
  -- ── chipping ────────────────────────────────────────────────────────────
  ('chipping',
   'Landing-spot towel drill',
   'Drop a towel where you want the ball to land and ignore the hole entirely. Chip to land on the towel and let the release do the rest. Builds the carry-vs-roll feel that turns a fat/thin contact miss into a reliable up-and-down.',
   NULL, 'drill', 'beginner'),
  ('chipping',
   'One club, three trajectories',
   'With your lob wedge around the green, hit the same shot low, medium, and high by changing only ball position and face. Trains the everything-club so contact (not direction) stays the only variable, which is exactly where your around-green misses live.',
   NULL, 'drill', 'intermediate'),
  -- ── bunker ──────────────────────────────────────────────────────────────
  ('bunker',
   'Draw-a-line splash drill',
   'Draw a line in the sand and make swings entering the sand ON the line, ball-less first, then with a ball just ahead of it. Trains a consistent entry point with the most-lofted wedge — your primary bunker club, never used off tight lies.',
   NULL, 'drill', 'beginner'),
  ('bunker',
   'Dollar-bill sand contact',
   'Picture a dollar bill under the ball; your job is to splash the whole bill out, not the ball. Reinforces taking sand first and accelerating through — the fix for the leave-it-in miss.',
   NULL, 'drill', 'intermediate'),
  -- ── 4i_path ─────────────────────────────────────────────────────────────
  ('4i_path',
   'Gate drill with a start-line stick',
   'Plant a stick on your intended start line and place a gate just ahead of the ball. Hit 4-irons (and the 3h) through the gate. Confirms whether the persistent right-lean is a path or a face issue before the book keeps planning around it.',
   NULL, 'drill', 'advanced'),
  ('4i_path',
   'Alignment-stick path check',
   'Lay one stick along the target line and a second along your toes; hit half-speed 4-irons watching where the divot points relative to the line. A right-pointing divot is path; a square divot with a right finish is face. Diagnoses the low-trust club without guessing.',
   NULL, 'drill', 'advanced'),
  -- ── short_irons ─────────────────────────────────────────────────────────
  ('short_irons',
   'Carry-number wedge ladder',
   'Pick three full-wedge carry numbers and hit five balls at each, reading carry on the monitor. Tightens the scoring-club distances you trust and surfaces your favorite full-wedge layup number for par fives.',
   NULL, 'drill', 'intermediate'),
  ('short_irons',
   'Low-runner knockdown reps',
   'Groove the land-it-short-and-release approach: ball back, hands forward, three-quarter finish, no speed reduction. Your owned shot into back pins and firm summer greens — reps keep it tournament-ready.',
   NULL, 'drill', 'intermediate')
) AS v(area, title, description, resource_url, resource_kind, level)
WHERE NOT EXISTS (SELECT 1 FROM drill d WHERE d.title = v.title);
