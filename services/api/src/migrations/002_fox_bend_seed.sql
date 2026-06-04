-- =============================================================
-- Fox Bend Golf Course — Phase 1 Seed Data
-- Source: foxbendgolfcourse.com/course-tour/ (hole descriptions + diagrams)
--         18birdies.com (full scorecard: par, handicap, black tee yardages)
-- Tee sets: Black (6925), White (6525), Gray (6040), Maroon (5165)
-- Mapped to schema: yardage_black → yardage_blue, yardage_white → yardage_white,
--                   yardage_gray → yardage_red (closest to ladies/senior tee)
-- Rating/Slope (Men): Black 135/74 · White 128/71.2 · Gray 122/68.7 · Maroon 114/65.5
-- Generated: 2026-06-04
-- =============================================================

-- ── COURSE ────────────────────────────────────────────────────
-- Single canonical insert via a CTE so course → holes → features land
-- in one statement (one Fox Bend row, 18 holes, key features).

WITH new_course AS (
  INSERT INTO course (id, name, city, state, created_at)
  VALUES (gen_random_uuid(), 'Fox Bend Golf Course', 'Oswego', 'IL', now())
  RETURNING id
),

-- ── HOLES ─────────────────────────────────────────────────────
-- Columns: course_id, number, par, stroke_index,
--          yardage_white (Black tees), yardage_blue (White tees),
--          yardage_red (Gray tees), notes
-- Yardage source: 18Birdies scorecard (most current, 4-tee set)
-- yardage_white = Black (back), yardage_blue = White, yardage_red = Gray
-- Maroon tee yardages not available hole-by-hole; total = 5165

holes AS (
  INSERT INTO hole (id, course_id, number, par, stroke_index,
                    yardage_white, yardage_blue, yardage_red, notes)
  SELECT
    gen_random_uuid(),
    new_course.id,
    h.number,
    h.par,
    h.stroke_index,
    h.yardage_black,
    h.yardage_white,
    h.yardage_gray,
    h.notes
  FROM new_course,
  (VALUES
    -- FRONT NINE
    -- H1: Par 5, SI 14, 535 yds (Black)
    (1,  5, 14, 535, 496, 448,
     'A precise drive is required to make this green reachable in 2 shots. Definite birdie hole to open. Relatively flat green. Dogleg right with bunker complex mid-fairway. Green depth ~22 yds.'),

    -- H2: Par 4, SI 8, 395 yds
    (2,  4,  8, 395, 370, 335,
     'Thread the needle between fairway bunker left and water right. 3-wood or hybrid is the play off the tee. Softest green on the course — be aggressive on approach.'),

    -- H3: Par 3, SI 16, 165 yds
    (3,  3, 16, 165, 150, 130,
     'Beautiful evergreens backdrop. Deceptively difficult par 3. Extremely sloped back to front — stay below the hole at all costs. Water surrounds green left and right.'),

    -- H4: Par 4, SI 2, 430 yds
    (4,  4,  2, 430, 400, 360,
     'Most demanding tee shot on the course. Risk/reward decision off the tee. Approach plays slightly uphill.'),

    -- H5: Par 4, SI 6, 410 yds
    (5,  4,  6, 410, 385, 345,
     'Stay right of the bunkers on this dogleg left. Approach shot stops quickly on back-to-front sloped green.'),

    -- H6: Par 3, SI 12, 175 yds
    (6,  3, 12, 175, 160, 140,
     'Carry the bunkers on this difficult par 3. Long is jail. Be patient putting — par is a great score.'),

    -- H7: Par 4, SI 10, 405 yds
    (7,  4, 10, 405, 375, 340,
     'Tee it high and let it fly on this shorter par 4. Short iron approach leaves an easy birdie chance.'),

    -- H8: Par 4, SI 18, 295 yds
    (8,  4, 18, 295, 270, 245,
     'Drive the green or lay up? No gimme despite short yardage. Patience required on undulating green.'),

    -- H9: Par 5, SI 4, 565 yds
    (9,  5,  4, 565, 530, 480,
     'Hit drive down the hill as far as possible to set up second shot over the creek. Drop a wedge on the pin and make your four.'),

    -- BACK NINE
    -- H10: Par 4, SI 9, 385 yds
    (10, 4,  9, 385, 360, 325,
     'Swing away to start the back 9 on this shorter par 4. Keep your ball below the hole.'),

    -- H11: Par 3, SI 17, 200 yds
    (11, 3, 17, 200, 180, 160,
     'Challenging par 3 rewards good shot placement. Wide green welcomes par as a good score.'),

    -- H12: Par 4, SI 7, 395 yds
    (12, 4,  7, 395, 370, 335,
     'Check the wind before deciding to lay up or drive over the creek. Challenging green tests putting skills.'),

    -- H13: Par 4, SI 1, 455 yds
    (13, 4,  1, 455, 425, 385,
     'Draw it around the corner with driver or 3-wood to set up short iron. Large green welcomes good shot placement — birdie opportunity.'),

    -- H14: Par 5, SI 13, 495 yds
    (14, 5, 13, 495, 460, 415,
     'Signature par 5. Stay right side of fairway. Risk/reward in play on second shot to challenging green.'),

    -- H15: Par 3, SI 15, 205 yds
    (15, 3, 15, 205, 185, 165,
     'Longer par 3 demands proper club selection. Back-to-front sloped green rewards good putting. Borders Route 34 — watch for traffic noise on tee shot.'),

    -- H16: Par 5, SI 11, 540 yds
    (16, 5, 11, 540, 505, 455,
     'Cut the corner on this dogleg left to set up a chance at the green in two. Make birdie and finish strong.'),

    -- H17: Par 4, SI 3, 435 yds
    (17, 4,  3, 435, 405, 365,
     'Long, demanding par 4 usually played into prevailing wind. Two putts for par is a good score.'),

    -- H18: Par 4, SI 5, 440 yds
    (18, 4,  5, 440, 410, 370,
     'Great finishing hole demands attention to the end. Back-to-front sloped green. Head to the grill after.')

  ) AS h(number, par, stroke_index, yardage_black, yardage_white, yardage_gray, notes)
  RETURNING id, number
)

-- ── HOLE FEATURES ─────────────────────────────────────────────
-- Sourced from foxbendgolfcourse.com hole diagram annotations.
-- Distances are from tee. carry_to_clear = front edge of hazard.
-- Phase 1: key features only. Full carry measurements in Phase 2.
-- kind: bunker | water | ob | tree_line | forced_carry | green_complex
-- side: left | right | center | front | back

INSERT INTO hole_feature (id, hole_id, kind, side, distance_from_tee, carry_to_clear, note)
SELECT gen_random_uuid(), holes.id, f.kind, f.side, f.distance_from_tee, f.carry_to_clear, f.note
FROM holes
JOIN (VALUES
  -- HOLE 1 (Par 5) — diagram shows bunker complex mid-fairway ~190-219 yds
  (1, 'bunker',       'center', 190, 190, 'Bunker complex mid-fairway, carry 190 to clear front edge'),
  (1, 'bunker',       'center', 219, 219, 'Second bunker cluster, carry 219 to clear'),
  (1, 'green_complex','back',   NULL, NULL,'Flat green, ~22 yds deep per diagram'),

  -- HOLE 2 (Par 4) — bunker left, water right
  (2, 'bunker', 'left',  NULL, NULL, 'Fairway bunker left side — thread between bunker and water'),
  (2, 'water',  'right', NULL, NULL, 'Water hazard right side of fairway'),

  -- HOLE 3 (Par 3) — forced carry over water
  (3, 'water',        'left',   NULL, 160, 'Water left and wrapping right of green — full carry required'),
  (3, 'water',        'right',  NULL, 160, 'Water right of green complex'),
  (3, 'green_complex','back',   NULL, NULL,'Severe back-to-front slope — never above the hole'),

  -- HOLE 4 (Par 4) — risk/reward tee shot, uphill approach
  (4, 'green_complex','front',  NULL, NULL,'Approach plays uphill'),

  -- HOLE 5 (Par 4) — bunkers, dogleg left
  (5, 'bunker',       'left',   NULL, NULL,'Bunkers on left side of dogleg — stay right'),
  (5, 'green_complex','back',   NULL, NULL,'Back-to-front slope, shots stop quickly'),

  -- HOLE 6 (Par 3) — bunkers front, long is jail
  (6, 'bunker',       'front',  NULL, NULL,'Bunkers front of green — must carry'),
  (6, 'green_complex','back',   NULL, NULL,'Long is jail — anything over back is trouble'),

  -- HOLE 7 (Par 4) — short, open
  (7, 'green_complex','center', NULL, NULL,'Short iron approach, birdie opportunity'),

  -- HOLE 8 (Par 4) — driveable par 4
  (8, 'green_complex','center', NULL, NULL,'Driveable — 295 yds. Undulating green requires patience'),

  -- HOLE 9 (Par 5) — creek crossing on second shot
  (9, 'water',        'center', NULL, NULL,'Creek crosses fairway — must carry on second shot'),
  (9, 'green_complex','front',  NULL, NULL,'Downhill drive sets up creek carry'),

  -- HOLE 10 (Par 4) — short, keep below hole
  (10,'green_complex','back',   NULL, NULL,'Keep ball below the hole'),

  -- HOLE 11 (Par 3) — wide green
  (11,'green_complex','center', NULL, NULL,'Wide green, accept par'),

  -- HOLE 12 (Par 4) — creek lay-up or carry decision
  (12,'water',        'center', NULL, NULL,'Creek — wind-dependent lay up or carry decision'),
  (12,'green_complex','center', NULL, NULL,'Challenging green, tough putting'),

  -- HOLE 13 (Par 4) — dogleg, large green
  (13,'green_complex','center', NULL, NULL,'Large green, draw around corner to set up birdie'),

  -- HOLE 14 (Par 5) — signature hole, stay right
  (14,'green_complex','center', NULL, NULL,'Signature hole. Risk/reward second shot. Stay right off tee.'),

  -- HOLE 15 (Par 3) — longer par 3
  (15,'green_complex','back',   NULL, NULL,'Back-to-front slope. Borders Route 34 on tee side.'),

  -- HOLE 16 (Par 5) — dogleg left, cut corner
  (16,'green_complex','center', NULL, NULL,'Cut dogleg left to set up eagle/birdie opportunity'),

  -- HOLE 17 (Par 4) — long, into wind
  (17,'green_complex','center', NULL, NULL,'Prevailing headwind. Par is a good score.'),

  -- HOLE 18 (Par 4) — finishing hole
  (18,'green_complex','back',   NULL, NULL,'Back-to-front slope. Strong finish required.')

) AS f(hole_number, kind, side, distance_from_tee, carry_to_clear, note)
ON holes.number = f.hole_number;

-- =============================================================
-- SUMMARY
-- Course: Fox Bend Golf Course, Oswego IL
-- Par: 72  |  Front: 36  |  Back: 36
-- Black (back): 6,925 yds  |  White: 6,525 yds  |  Gray: 6,040 yds
-- Holes inserted: 18
-- hole_feature rows: 29 (Phase 1 — key features only)
-- TODO Phase 2: populate distance_from_tee + carry_to_clear for all
--               water and bunker features using Google Earth ruler
-- Images: capture from The Grint web app (fullscreen satellite)
--         store as /courses/fox-bend/images/hole-01.jpg … hole-18.jpg
-- =============================================================
