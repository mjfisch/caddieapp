import { describe, it, expect } from "vitest";
import { getBagClubs, getClubShotCounts, runMigrations } from "@gai/api";
import {
  type BagClubView,
  buildCarryMap,
  clubDisplayName,
  dispersionBand,
  carryConfidenceLine,
  isDispersionEstimated,
  formatSessionDate,
  latestSession,
  shotDataProgress,
  SHOT_TARGET,
} from "../apps/web/src/app/bag/bagView";

// Mission 3a — Bag tab, ALL CLUBS list. The presentation helpers are pure (no
// React, no I/O), so the page's behavior is asserted directly here. The page
// imports the SAME module, so what's tested is what ships.

const measured = (over: Partial<BagClubView> = {}): BagClubView => ({
  club: "7i",
  carryYards: 158,
  lateralSdYards: 8,
  shotCount: 11,
  confidence: "measured",
  lastSession: "2026-06-03",
  ...over,
});

describe("clubDisplayName", () => {
  it("maps canonical ids to the prototype's bag labels", () => {
    expect(clubDisplayName("driver")).toBe("Driver");
    expect(clubDisplayName("7i")).toBe("7-iron");
    expect(clubDisplayName("3h")).toBe("3-hybrid");
    expect(clubDisplayName("PW")).toBe("PW");
    expect(clubDisplayName("GW50")).toBe("50° GW");
    expect(clubDisplayName("LW64")).toBe("64° LW");
  });
});

describe("dispersionBand — color encodes consistency QUALITY (yards, lower is tighter)", () => {
  it("bands ≤5 yd Tight/green, ≤9 Steady/amber, >9 Loose/red", () => {
    expect(dispersionBand(2)).toMatchObject({ level: "tight", word: "Tight", color: "var(--green)" });
    expect(dispersionBand(5)).toMatchObject({ level: "tight" }); // boundary is tight
    expect(dispersionBand(6)).toMatchObject({ level: "steady", word: "Steady", color: "var(--amber)" });
    expect(dispersionBand(9)).toMatchObject({ level: "steady" }); // boundary is steady
    expect(dispersionBand(10)).toMatchObject({ level: "loose", word: "Loose", color: "var(--red)" });
    expect(dispersionBand(16)).toMatchObject({ level: "loose" });
  });

  it("fills the bar proportionally to looseness, clamped to [0.08, 1]", () => {
    expect(dispersionBand(2).fill).toBeCloseTo(2 / 18, 5);
    expect(dispersionBand(0).fill).toBe(0.08); // floor so a tight club is still visible
    expect(dispersionBand(40).fill).toBe(1); // cap
  });
});

describe("formatSessionDate", () => {
  it("renders an ISO date as 'Mon D, YYYY'", () => {
    expect(formatSessionDate("2026-05-18")).toBe("May 18, 2026");
    expect(formatSessionDate("2022-11-16")).toBe("Nov 16, 2022");
  });
});

describe("dual confidence — carry and dispersion certainty are INDEPENDENT (invariant #2)", () => {
  it("carry line: a measured club shows its last-measured date", () => {
    expect(carryConfidenceLine(measured({ lastSession: "2026-05-18" }))).toBe("May 18, 2026");
  });

  it("carry line: an unmeasured club reads 'Not yet measured'", () => {
    expect(carryConfidenceLine(measured({ confidence: "seeded", lastSession: null }))).toBe("Not yet measured");
    // measured flag but no date is still not a real measurement to show
    expect(carryConfidenceLine(measured({ lastSession: null }))).toBe("Not yet measured");
  });

  it("dispersion: a seeded-from-benchmark rating renders as an estimate, even with a solid carry", () => {
    expect(isDispersionEstimated(measured({ confidence: "seeded" }))).toBe(true);
    // thin real sample (<5 shots) is also not yet trustworthy
    expect(isDispersionEstimated(measured({ confidence: "partial", shotCount: 3 }))).toBe(true);
    expect(isDispersionEstimated(measured({ shotCount: 4 }))).toBe(true);
  });

  it("dispersion: a measured rating backed by a real 5+ shot sample is NOT muted", () => {
    expect(isDispersionEstimated(measured({ shotCount: 11 }))).toBe(false);
    expect(isDispersionEstimated(measured({ shotCount: 5 }))).toBe(false);
  });
});

describe("latestSession", () => {
  it("picks the most recent date across the bag", () => {
    const clubs = [measured({ lastSession: "2026-05-12" }), measured({ lastSession: "2026-06-03" }), measured({ lastSession: "2022-11-16" })];
    expect(latestSession(clubs)).toBe("Jun 3, 2026");
  });
  it("is null when no club has a date", () => {
    expect(latestSession([measured({ lastSession: null })])).toBeNull();
  });
});

// ── Mission 3b — Card 1 shot-count progress (COMPUTED, not the model) ───────────

describe("shotDataProgress — bag clubs vs the 20-shot target", () => {
  const clubs = [
    measured({ club: "driver" }),
    measured({ club: "7i" }),
    measured({ club: "PW" }),
  ];

  it("uses a 20-shot target", () => {
    expect(SHOT_TARGET).toBe(20);
  });

  it("counts clubs at/above the target and names those below by display name", () => {
    const p = shotDataProgress(clubs, { driver: 25, "7i": 20, PW: 12 });
    expect(p.total).toBe(3);
    expect(p.reached).toBe(2); // 25 and 20 (boundary) both clear
    expect(p.below).toEqual(["PW"]); // display name, only the club under 20
    expect(p.allReached).toBe(false);
  });

  it("treats a club with no shot-log rows as 0", () => {
    const p = shotDataProgress([measured({ club: "driver" })], {});
    expect(p.reached).toBe(0);
    expect(p.below).toEqual(["Driver"]);
  });

  it("flips allReached true only when every club hits the target", () => {
    const p = shotDataProgress(clubs, { driver: 20, "7i": 99, PW: 20 });
    expect(p.allReached).toBe(true);
    expect(p.below).toEqual([]);
    expect(p.reached).toBe(3);
  });
});

// ── Mission 3b — carry & consistency RATING map geometry ────────────────────────

describe("buildCarryMap — consistency RATING map (color + size = band, x = carry)", () => {
  // A small bag in carry-desc order, as getBagClubs returns it.
  const bag = (): BagClubView[] => [
    measured({ club: "driver", carryYards: 273, lateralSdYards: 16 }), // Loose
    measured({ club: "7i", carryYards: 158, lateralSdYards: 8 }), // Steady
    measured({ club: "GW50", carryYards: 107, lateralSdYards: 5 }), // Tight
    measured({ club: "LW64", carryYards: 76, lateralSdYards: 4 }), // Tight
  ];

  it("renders every club, driver rightmost and the shortest club leftmost", () => {
    const m = buildCarryMap(bag());
    expect(m.points).toHaveLength(4);
    expect(m.points[0]!.club).toBe("driver");
    expect(m.points.at(-1)!.club).toBe("LW64");
    // x tracks carry: driver (longest) is rightmost, 64° LW (shortest) leftmost
    expect(m.points[0]!.cx).toBeGreaterThan(m.points.at(-1)!.cx);
    // stacked diagonally: cy strictly increases down the list
    for (let i = 1; i < m.points.length; i++) {
      expect(m.points[i]!.cy).toBeGreaterThan(m.points[i - 1]!.cy);
    }
  });

  it("ellipse color matches each club's Tight/Steady/Loose band", () => {
    const byClub = Object.fromEntries(buildCarryMap(bag()).points.map((p) => [p.club, p]));
    expect(byClub.driver!.color).toBe("var(--red)"); // 16 yd → Loose
    expect(byClub["7i"]!.color).toBe("var(--amber)"); // 8 yd → Steady
    expect(byClub.GW50!.color).toBe("var(--green)"); // 5 yd → Tight
  });

  it("sizes both ellipse dimensions by looseness — looser clubs are larger", () => {
    const byClub = Object.fromEntries(buildCarryMap(bag()).points.map((p) => [p.club, p]));
    expect(byClub.driver!.rx).toBeGreaterThan(byClub.GW50!.rx);
    expect(byClub.driver!.ry).toBeGreaterThan(byClub.GW50!.ry);
  });

  it("renders seeded/partial clubs muted vs measured (dual confidence on the map)", () => {
    const m = buildCarryMap([
      measured({ club: "7i", shotCount: 11 }),
      measured({ club: "driver", confidence: "seeded", shotCount: 0 }),
    ]);
    const meas = m.points.find((p) => p.club === "7i")!;
    const seed = m.points.find((p) => p.club === "driver")!;
    expect(meas.estimated).toBe(false);
    expect(seed.estimated).toBe(true);
    expect(seed.opacity).toBeLessThan(meas.opacity);
  });

  it("places gridlines at 100/150/200/250, left-to-right ascending", () => {
    const m = buildCarryMap(bag());
    expect(m.gridLines.map((g) => g.carry)).toEqual([100, 150, 200, 250]);
    const xs = m.gridLines.map((g) => g.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });
});

// ── DB-gated, READ-ONLY: assert the list the page renders off the live DB ───────
// No writes, so it's safe against the shared Neon DB (it cannot leak fixtures).
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("getBagClubs — the canonical ALL CLUBS list", () => {
  it("returns the 13-club bag, ordered by carry descending (driver first)", async () => {
    await runMigrations();
    const clubs = await getBagClubs();

    expect(clubs).toHaveLength(13);
    expect(clubs[0]!.club).toBe("driver"); // longest carry leads

    const carries = clubs.map((c) => c.carryYards);
    const sorted = [...carries].sort((a, b) => b - a);
    expect(carries).toEqual(sorted); // non-increasing

    // Every club carries a confidence flag and a real lateral-SD number (invariant #2).
    for (const c of clubs) {
      expect(["measured", "partial", "seeded"]).toContain(c.confidence);
      expect(c.lateralSdYards).toBeGreaterThanOrEqual(0);
    }
  });

  it("driver renders off its (stale) measured sample, with its date as the honesty signal", async () => {
    const clubs = await getBagClubs();
    const driver = clubs.find((c) => c.club === "driver")!;
    expect(driver.confidence).toBe("measured");
    // Chosen call: trust the flag — measured driver is NOT muted; its visible
    // last-session date tells the staleness truth instead.
    expect(isDispersionEstimated(driver)).toBe(false);
    expect(carryConfidenceLine(driver)).not.toBe("Not yet measured");
  });
});

describe.skipIf(!hasDb)("getClubShotCounts — Card 1 reads the live shot log", () => {
  it("returns a per-club count from the shot table, reconciling with the bag", async () => {
    await runMigrations();
    const [counts, clubs] = await Promise.all([getClubShotCounts(), getBagClubs()]);

    // Every count is a non-negative integer; no stray (non-bag) clubs leak in.
    const bag = new Set(clubs.map((c) => c.club));
    for (const [club, n] of Object.entries(counts)) {
      expect(bag.has(club)).toBe(true);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
    }

    // Card 1's tally is internally consistent over the real 13-club bag.
    const p = shotDataProgress(clubs, counts);
    expect(p.total).toBe(13);
    expect(p.reached + p.below.length).toBe(13);
    expect(p.reached).toBeLessThanOrEqual(13);
  });
});
