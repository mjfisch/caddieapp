-- =============================================================
-- Past Ladder — set `better` on its metric defs (follow-up to 013).
--
-- 013 seeded all six Past Ladder defs with better = NULL so the drill would
-- not start plotting against a guessed direction. This sets the direction now
-- that the stats treatment is decided. How computePracticeStats.ts uses it
-- (apps/web/src/app/stats/computePracticeStats.ts, buildDrillCards):
--   primary     = the FIRST def by sort_order with better set — one card per
--                 drill, and more than one scored def does NOT make more cards;
--   parameter   = the first def with better NULL and a unit   (the x-context);
--   denominator = the first def with better NULL and no unit  (the "out of").
-- A def carrying `better` is therefore removed from parameter/denominator
-- candidacy, which is what decides the four non-headline rows below.
--
-- Per-def choices (allowed values: 'lower' | 'higher' | NULL — the 009 CHECK):
--   Distance (0, ft)        NULL     Set-up input, not an outcome. Stays the
--                                    parameter axis carried on every point.
--   Balls (1)               NULL     Set-up input. Stays the denominator
--                                    ("Short 2 of 10").
--   Short (2)               'lower'  THE PRIMARY. It is the failure the drill
--                                    exists to expose (013 header) and the
--                                    drill's own progression rule ("move back
--                                    to 45 ft after two sessions at Short <= 2").
--                                    sort_order 2 < In zone's 3, so Short wins
--                                    the primary slot — intended.
--   In zone (3)             'higher' Obviously higher-is-better. Recorded for
--                                    meaning; does not change the card (Short
--                                    precedes it).
--   Long (4)                'lower'  Past but outside 4 ft is a fail, so fewer
--                                    is better. Setting it changes nothing on
--                                    the card today (Short is still primary,
--                                    Balls still precedes it as denominator) but
--                                    takes an OUTCOME out of denominator
--                                    candidacy: if Balls were ever left blank,
--                                    a NULL Long would silently become the "out
--                                    of" number.
--   Longest comeback (5,ft) 'lower'  Shorter comebacks are better. Same
--                                    reasoning: it carries a unit, so as NULL it
--                                    is a parameter candidate; only Distance
--                                    preceding it keeps it off the axis. An
--                                    outcome must never be the parameter.
-- Net effect: exactly one card for Past Ladder — primary Short (lower,
-- trend render once any block has Short >= 2), parameter Distance (ft),
-- denominator Balls when constant.
--
-- Binds by drill title + label. Absolute UPDATEs, so re-running is a no-op.
-- Runs inside the applyMigrations() advisory-locked transaction
-- (services/api/src/db.ts); no BEGIN/COMMIT here (the runner owns it).
-- =============================================================

UPDATE drill_metric_def dmd
   SET better = v.better
  FROM drill d,
       (VALUES
         ('Distance',         NULL::text),
         ('Balls',            NULL::text),
         ('Short',            'lower'),
         ('In zone',          'higher'),
         ('Long',             'lower'),
         ('Longest comeback', 'lower')
       ) AS v(label, better)
 WHERE d.title = 'Past Ladder'
   AND dmd.drill_id = d.id
   AND dmd.label = v.label;
