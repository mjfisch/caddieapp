import { describe, it, expect, beforeAll } from "vitest";
import { parseHandicapSeed, seedDispersion, runMigrations, getPool } from "@gai/api";

// Pure parser test — no DB, always runs. Verifies the seed derives dispersion
// from the tier model (lateral/distance % of carry), falls back to the tier
// default carry for a null measured carry (driver), and flags everything seeded.
const FIXTURE = [
  "# seed",
  "",
  "```json",
  JSON.stringify({
    model: {
      ellipse_sd_multiplier: 2.0,
      tiers: { scratch: { lateral_pct: 0.055, distance_pct: 0.04 } },
    },
    default_carries_yards: { scratch: { driver: 265, "7i": 160 } },
    player_michael_measured_carries_yards: { driver: null, "7i": 160, PW: 121 },
    player_michael_tier: "scratch",
  }),
  "```",
].join("\n");

describe("parseHandicapSeed: tier model -> seeded dispersion", () => {
  const rows = parseHandicapSeed(FIXTURE);
  const byClub = Object.fromEntries(rows.map((r) => [r.club, r]));

  it("produces one seeded row per club in the measured bag", () => {
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.confidence === "seeded")).toBe(true);
  });

  it("derives lateral/carry SD as a percent of carry", () => {
    // 7i: 160 carry -> lateral 160*.055=8.8, carry SD 160*.04=6.4
    expect(byClub["7i"]).toMatchObject({
      carry_mean_yards: 160,
      lateral_sd_yards: 8.8,
      carry_sd_yards: 6.4,
    });
  });

  it("falls back to the tier default carry for a null measured carry (driver)", () => {
    expect(byClub["driver"]).toMatchObject({
      carry_mean_yards: 265, // from default_carries_yards, not measured (null)
      confidence: "seeded", // never partial — zero real shots
    });
  });
});

// DB-gated: seed the live DB from the real handicap_dispersion_seed.md, then
// confirm rows exist for the whole bag, all seeded, driver included. Idempotent
// (ON CONFLICT updates non-measured rows) and never downgrades a measured row.
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("seedDispersion: seeds the real handicap file into club_dispersion", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  it("seeds every bag club as seeded, with driver included", async () => {
    const summary = await seedDispersion();
    // Real file's measured bag: driver,3h,4i,5h,6i,7i,8i,9i,PW,GW50,SW54,LW60,LW64
    expect(summary.seeded.length + summary.skippedMeasured.length).toBeGreaterThanOrEqual(13);

    const pool = getPool();
    const { rows } = await pool.query<{ club: string; confidence: string; carry_mean_yards: string }>(
      "SELECT club, confidence, carry_mean_yards FROM club_dispersion WHERE club = ANY($1)",
      [["driver", "7i", "PW"]]
    );
    const byClub = Object.fromEntries(rows.map((r) => [r.club, r]));

    // Driver is seeded (PENDING), never partial — it has zero real shots.
    expect(byClub["driver"]?.confidence).toBe("seeded");
    expect(Number(byClub["driver"]?.carry_mean_yards)).toBe(265);

    // 7i: measured carry 160, dispersion still seeded.
    expect(byClub["7i"]?.confidence).toBe("seeded");
    expect(Number(byClub["7i"]?.carry_mean_yards)).toBe(160);
  });
});
