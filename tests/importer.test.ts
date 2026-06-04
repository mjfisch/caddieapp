import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  runMigrations,
  getPool,
  insertShots,
  recomputeDispersion,
  parseTrackmanCsv,
  MEASURED_MIN_SHOTS,
  type ShotRow,
} from "@gai/api";

// Pure parser test — no DB, always runs. Covers header normalization (units in
// parens), the L/R carry-side convention, and skipping rows without club+carry.
describe("parseTrackmanCsv: header mapping + numeric coercion", () => {
  it("maps Trackman headers and parses signed carry side", () => {
    const csv = [
      "Club,Carry (yds),Total,Ball Speed (mph),Launch Angle,Launch Direction,Carry Side (yds),Date",
      '7 Iron,165.4,173,114.8,18.2,-1.1,"4.2 R",2026-06-04',
      "Pitching Wedge,128,135,98,24,0.5,3.1L,2026-06-04",
      ",,,,,,,", // junk row: no club/carry -> skipped
    ].join("\n");

    const rows = parseTrackmanCsv(csv);
    expect(rows).toHaveLength(2);

    expect(rows[0]).toMatchObject({
      club: "7 Iron",
      carry_yards: 165.4,
      total_yards: 173,
      ball_speed_mph: 114.8,
      launch_dir_deg: -1.1,
      carry_side_yards: 4.2, // "R" -> positive
      session_date: "2026-06-04",
    });
    expect(rows[1].carry_side_yards).toBe(-3.1); // "L" -> negative
  });
});

// Phase 2A: 15 synthetic 7-iron shots -> recompute -> club_dispersion flips to
// `measured`. Requires the live DB (Neon in dev/prod); skip loudly otherwise,
// same gate as the round-trip / migrations tests. Synthetic rows are tagged
// source='vitest' and deleted before and after, so re-runs are idempotent and
// real imported data is never touched.
const hasDb = Boolean(process.env.DATABASE_URL);
const TEST_SOURCE = "vitest";
const TEST_CLUB = "7-iron";

// 15 plausible 7-iron carries (mean ~165, a few yards of spread) + small side misses.
const CARRIES = [160, 162, 163, 164, 165, 165, 166, 166, 167, 168, 170, 163, 167, 164, 166];
const SIDES = [-4, 2, -1, 3, 0, -2, 5, -3, 1, 4, -5, 2, -1, 3, -2];

const SYNTHETIC: ShotRow[] = CARRIES.map((carry, i) => ({
  club: TEST_CLUB,
  carry_yards: carry,
  total_yards: carry + 8,
  ball_speed_mph: 115,
  launch_angle_deg: 18,
  launch_dir_deg: 0,
  carry_side_yards: SIDES[i],
  session_date: "2026-06-04",
}));

describe.skipIf(!hasDb)("importer: recompute flips club_dispersion to measured", () => {
  beforeAll(async () => {
    await runMigrations();
    await getPool().query("DELETE FROM shot WHERE source = $1", [TEST_SOURCE]);
  });

  afterAll(async () => {
    await getPool().query("DELETE FROM shot WHERE source = $1", [TEST_SOURCE]);
  });

  it(`flips ${TEST_CLUB} to measured after ${MEASURED_MIN_SHOTS}+ shots, with a sane carry SD`, async () => {
    const pool = getPool();

    const inserted = await insertShots(pool, SYNTHETIC, TEST_SOURCE);
    expect(inserted).toBe(15);

    const results = await recomputeDispersion(pool, [TEST_CLUB]);
    const seven = results.find((r) => r.club === TEST_CLUB);

    expect(seven, "7-iron should be recomputed once it clears the threshold").toBeDefined();
    expect(seven!.confidence).toBe("measured");
    expect(seven!.shot_count).toBeGreaterThanOrEqual(15);

    // Carry mean should sit near the synthetic average (~165).
    expect(seven!.carry_mean_yards).toBeGreaterThan(150);
    expect(seven!.carry_mean_yards).toBeLessThan(180);

    // Sample SD of the synthetic carries is ~2.7; allow a generous band in case
    // pre-existing real 7-iron shots are mixed in. It must be a real positive SD.
    expect(seven!.carry_sd_yards).toBeGreaterThan(0);
    expect(seven!.carry_sd_yards).toBeLessThan(30);

    // Lateral SD comes from carry_side and must populate the NOT NULL column.
    expect(seven!.lateral_sd_yards).toBeGreaterThan(0);

    // And the persisted row agrees with what recompute returned.
    const { rows } = await pool.query<{ confidence: string; shot_count: number }>(
      "SELECT confidence, shot_count FROM club_dispersion WHERE club = $1",
      [TEST_CLUB]
    );
    expect(rows[0]?.confidence).toBe("measured");
    expect(rows[0]?.shot_count).toBeGreaterThanOrEqual(15);
  });
});

describe.skipIf(hasDb)("importer (skipped — no DATABASE_URL)", () => {
  it("is skipped without DATABASE_URL", () => {
    expect(hasDb).toBe(false);
  });
});
