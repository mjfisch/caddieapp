import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  computeStats,
  selectWindow,
  formatSignedDelta,
  type StatsRound,
  type StatsHole,
  type StatsFairwayResult,
} from "../apps/web/src/app/stats/computeStats";

// =============================================================
// Mission S6 — the Stats derivation module, pinned to ground truth.
//
// The fixture is the June 22 Fox Bend round, read straight from its D22
// payload file (data/rounds/2026-06-22_fox-bend.json) — a file, not a DB row,
// so these tests are credential-free by design. Every expected value below is
// known ground truth for that round.
// =============================================================

type PayloadHole = {
  hole: number;
  par: number;
  strokes: number;
  putts: number;
  fairway_result: StatsFairwayResult | null;
  gir: boolean;
};

function loadFixtureRound(): StatsRound {
  const path = fileURLToPath(
    new URL("../data/rounds/2026-06-22_fox-bend.json", import.meta.url),
  );
  const payload = JSON.parse(readFileSync(path, "utf8")) as {
    date: string;
    score: { differential: number };
    holes: PayloadHole[];
  };
  return {
    playedDate: payload.date,
    differential: payload.score.differential,
    isTest: false,
    holes: payload.holes.map(
      (h): StatsHole => ({
        par: h.par,
        strokes: h.strokes,
        putts: h.putts,
        fairwayResult: h.fairway_result,
        gir: h.gir,
      }),
    ),
  };
}

describe("computeStats — golden values from the June 22 Fox Bend round", () => {
  const stats = computeStats([loadFixtureRound()])!;

  it("returns a result for a one-round window", () => {
    expect(stats).not.toBeNull();
    expect(stats.rounds).toBe(1);
  });

  it("group 1 — average gross score 81.0", () => {
    expect(stats.avgScore).toBe(81.0);
  });

  it("group 2 — average differential 8.7", () => {
    expect(stats.avgDifferential).toBe(8.7);
  });

  it("group 3 — fairway split 21.4 hit / 42.9 left / 35.7 right", () => {
    expect(stats.fairways).toEqual({
      hitPct: 21.4,
      missLeftPct: 42.9,
      missRightPct: 35.7,
    });
  });

  it("group 3 — the split's raw denominator is exhaustive (sums to 100)", () => {
    const f = stats.fairways!;
    expect(round1(f.hitPct + f.missLeftPct + f.missRightPct)).toBe(100.0);
  });

  it("group 4 — GIR 55.6%", () => {
    expect(stats.girPct).toBe(55.6);
  });

  it("group 5 — 32.0 putts per round, splitting 5 / 12 / 1", () => {
    expect(stats.putting).toEqual({
      avgPutts: 32.0,
      onePutt: 5.0,
      twoPutt: 12.0,
      threePlus: 1.0,
    });
  });

  it("group 6 — par-type deltas +1.00 / +0.30 / +0.50", () => {
    expect(stats.parType).toEqual({ par3: 1.0, par4: 0.3, par5: 0.5 });
    expect(formatSignedDelta(stats.parType.par3!)).toBe("+1.00");
    expect(formatSignedDelta(stats.parType.par4!)).toBe("+0.30");
    expect(formatSignedDelta(stats.parType.par5!)).toBe("+0.50");
  });

  it("group 7 — distribution 1 bird+ / 9 par / 6 bogey / 2 dbl+", () => {
    expect(stats.distribution).toEqual({
      birdieOrBetter: 1.0,
      par: 9.0,
      bogey: 6.0,
      doubleOrWorse: 2.0,
    });
  });
});

describe("computeStats — sparse-data honesty", () => {
  it("an empty window returns null, never fabricated zeros", () => {
    expect(computeStats([])).toBeNull();
  });

  it("no known-direction holes -> fairways is null, not a fake split", () => {
    const r = mkRound("2026-06-01", 8.0, {
      holes: [hole({ par: 3, fairwayResult: null })],
    });
    expect(computeStats([r])!.fairways).toBeNull();
  });

  it("negative par-type deltas format with their sign", () => {
    expect(formatSignedDelta(-0.25)).toBe("-0.25");
    expect(formatSignedDelta(0)).toBe("+0.00");
  });

  it("averages over two rounds are real means, not padded", () => {
    // Fixture round (81) + an all-par round (72 on par 72): mean 76.5.
    const even = mkRound("2026-06-29", 2.1, {
      holes: Array.from({ length: 18 }, (_, i) =>
        hole({
          par: i < 4 ? 3 : i < 14 ? 4 : 5,
          strokes: i < 4 ? 3 : i < 14 ? 4 : 5,
          putts: 2,
          fairwayResult: i < 4 ? null : "hit",
          gir: true,
        }),
      ),
    });
    const stats = computeStats([loadFixtureRound(), even])!;
    expect(stats.rounds).toBe(2);
    expect(stats.avgScore).toBe(76.5);
    expect(stats.avgDifferential).toBe(5.4); // (8.7 + 2.1) / 2
    expect(stats.girPct).toBe(77.8); // (10/18 + 18/18) / 2
  });
});

// ── Window logic (design doc §4: three filters, all excluding is_test) ────────

function hole(overrides: Partial<StatsHole> = {}): StatsHole {
  return {
    par: 4,
    strokes: 5,
    putts: 2,
    fairwayResult: "hit",
    gir: false,
    ...overrides,
  };
}

function mkRound(
  playedDate: string,
  differential: number,
  overrides: Partial<StatsRound> = {},
): StatsRound {
  return {
    playedDate,
    differential,
    isTest: false,
    holes: [hole()],
    ...overrides,
  };
}

/** June 2026 fixture calendar: one round per day, newest = highest day. */
function juneRounds(count: number): StatsRound[] {
  return Array.from({ length: count }, (_, i) =>
    mkRound(`2026-06-${String(i + 1).padStart(2, "0")}`, 10 + i),
  );
}

describe("selectWindow — is_test exclusion (every window)", () => {
  const rounds = [
    mkRound("2026-06-05", 12.0, { isTest: true }),
    mkRound("2026-06-13", 11.0, { isTest: true }),
    mkRound("2026-06-22", 8.7),
  ];

  it.each(["last20", "ytd", "hcp8"] as const)("%s hides test rounds", (w) => {
    const win = selectWindow(rounds, w, 2026);
    expect(win).toHaveLength(1);
    expect(win[0]!.playedDate).toBe("2026-06-22");
  });
});

describe("selectWindow — Last 20", () => {
  it("keeps the 20 most recent by played_date, newest first", () => {
    // Shuffle the input so the ordering must come from played_date, not
    // insertion order.
    const rounds = juneRounds(25);
    const shuffled = [...rounds].sort((a, b) => a.differential % 3 - (b.differential % 3));
    const win = selectWindow(shuffled, "last20", 2026);
    expect(win).toHaveLength(20);
    expect(win[0]!.playedDate).toBe("2026-06-25");
    expect(win[19]!.playedDate).toBe("2026-06-06");
    expect(win.map((r) => r.playedDate)).toEqual(
      rounds.slice(5).map((r) => r.playedDate).reverse(),
    );
  });

  it("returns fewer than 20 when fewer exist", () => {
    expect(selectWindow(juneRounds(3), "last20", 2026)).toHaveLength(3);
  });
});

describe("selectWindow — YTD", () => {
  it("keeps only rounds in the current calendar year", () => {
    const rounds = [
      mkRound("2025-12-30", 9.0),
      mkRound("2026-01-02", 10.0),
      mkRound("2026-06-22", 8.7),
    ];
    const win = selectWindow(rounds, "ytd", 2026);
    expect(win.map((r) => r.playedDate)).toEqual(["2026-06-22", "2026-01-02"]);
  });

  it("an empty year is an empty window (never padded from other years)", () => {
    expect(selectWindow([mkRound("2025-08-01", 9.0)], "ytd", 2026)).toEqual([]);
  });
});

describe("selectWindow — Hcp 8", () => {
  it("selects the 8 lowest differentials among the Last 20 only", () => {
    // 21 rounds; the OLDEST (outside the Last 20) has the lowest differential
    // of all — it must NOT be selected.
    const rounds = juneRounds(21).map((r, i) =>
      i === 0 ? { ...r, differential: 0.1 } : r,
    );
    const win = selectWindow(rounds, "hcp8", 2026);
    expect(win).toHaveLength(8);
    expect(win.some((r) => r.playedDate === "2026-06-01")).toBe(false);
    // The last-20 window is Jun 2–22 with differentials 11..30 — lowest 8 = 11..18.
    expect(win.map((r) => r.differential).sort((a, b) => a - b)).toEqual([
      11, 12, 13, 14, 15, 16, 17, 18,
    ]);
  });

  it("uses all rounds when fewer than 8 exist", () => {
    const win = selectWindow(juneRounds(5), "hcp8", 2026);
    expect(win).toHaveLength(5);
  });
});

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
