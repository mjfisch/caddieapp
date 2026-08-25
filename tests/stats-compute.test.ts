import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  computeStats,
  selectWindow,
  formatSignedDelta,
  formatRoundDate,
  formatVsPar,
  roundGross,
  roundParTotal,
  scoreMark,
  splitNines,
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

function loadRound(
  file: string,
  id: string,
  courseName: string,
  teeName: string,
): StatsRound {
  const path = fileURLToPath(new URL(`../data/rounds/${file}`, import.meta.url));
  const payload = JSON.parse(readFileSync(path, "utf8")) as {
    date: string;
    score: { differential: number };
    holes: PayloadHole[];
  };
  return {
    id,
    playedDate: payload.date,
    courseName,
    teeName,
    differential: payload.score.differential,
    isTest: false,
    holes: payload.holes.map(
      (h): StatsHole => ({
        holeNumber: h.hole,
        par: h.par,
        strokes: h.strokes,
        putts: h.putts,
        fairwayResult: h.fairway_result,
        gir: h.gir,
      }),
    ),
  };
}

function loadFixtureRound(): StatsRound {
  return loadRound(
    "2026-06-22_fox-bend.json",
    "fixture-fox-bend-2026-06-22",
    "Fox Bend Golf Course",
    "White",
  );
}

/** The Aug 22 Carillon round — the S10 mockup's worked example. */
function loadCarillonRound(): StatsRound {
  return loadRound(
    "2026-08-22_carillon-red-white.json",
    "fixture-carillon-2026-08-22",
    "The Links at Carillon - Red/White",
    "Blue",
  );
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
          holeNumber: i + 1,
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
    holeNumber: 1,
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
    id: `round-${playedDate}-${differential}`,
    playedDate,
    courseName: "Fox Bend Golf Course",
    teeName: "White",
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

// =============================================================
// Mission S10 — the round listing's display helpers, pinned to the Aug 22
// Carillon round (data/rounds/2026-08-22_carillon-red-white.json). Ground
// truth: 74 (+2) on a par 72, out 38 / in 36, 14 / 17 putts, 4 / 7 GIR,
// 2 / 5 fairways, and the footer figures the design draft shows.
// =============================================================

describe("round listing — collapsed row fields", () => {
  const carillon = loadCarillonRound();

  it("formats the date as an uppercase D MON YYYY, straight off the ISO string", () => {
    expect(formatRoundDate("2026-08-22")).toBe("22 AUG 2026");
    expect(formatRoundDate("2026-01-02")).toBe("2 JAN 2026");
    // No Date parsing means no timezone can shift the day.
    expect(formatRoundDate(carillon.playedDate)).toBe("22 AUG 2026");
  });

  it("gross score is the strokes actually recorded — the same total the cards average", () => {
    expect(roundGross(carillon)).toBe(74);
    expect(computeStats([carillon])!.avgScore).toBe(roundGross(carillon));
  });

  it("par total comes from the course model, and vs-par reads +2", () => {
    expect(roundParTotal(carillon)).toBe(72);
    expect(formatVsPar(roundGross(carillon) - roundParTotal(carillon)!)).toBe("+2");
  });

  it("level par renders E, never +0", () => {
    expect(formatVsPar(0)).toBe("E");
    expect(formatVsPar(-3)).toBe("−3");
    expect(formatVsPar(13)).toBe("+13");
  });

  it("a round with no course model has no par total — vs-par is omitted, not guessed", () => {
    const parless = mkRound("2026-07-01", 9.0, {
      holes: [hole({ par: null }), hole({ holeNumber: 2, par: null })],
    });
    expect(roundParTotal(parless)).toBeNull();
  });
});

describe("round listing — the two nines", () => {
  const { front, back } = splitNines(loadCarillonRound());

  it("splits 1–9 and 10–18 with the Out/In labels", () => {
    expect(front!.label).toBe("Out");
    expect(back!.label).toBe("In");
    expect(front!.holes.map((h) => h.holeNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(back!.holes.map((h) => h.holeNumber)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
  });

  it("Out / In totals are 38 / 36 strokes over 36 / 36 par", () => {
    expect(front!.strokes).toBe(38);
    expect(back!.strokes).toBe(36);
    expect(front!.par).toBe(36);
    expect(back!.par).toBe(36);
  });

  it("Out / In putts are 14 / 17", () => {
    expect(front!.putts).toBe(14);
    expect(back!.putts).toBe(17);
  });

  it("Out / In GIR counts are 4 / 7", () => {
    expect(front!.gir).toBe(4);
    expect(back!.gir).toBe(7);
  });

  it("Out / In fairways hit are 2 / 5 (par 3s never in the denominator)", () => {
    expect(front!.fairways).toBe(2);
    expect(back!.fairways).toBe(5);
  });

  it("a nine-hole round yields one table, not an empty back nine", () => {
    const nineHole = mkRound("2026-07-04", 7.0, {
      holes: Array.from({ length: 9 }, (_, i) => hole({ holeNumber: i + 1 })),
    });
    const split = splitNines(nineHole);
    expect(split.front).not.toBeNull();
    expect(split.back).toBeNull();
  });
});

describe("round listing — score marks follow the paper convention", () => {
  const mark = (par: number | null, strokes: number) =>
    scoreMark(hole({ par, strokes }));

  it("circles birdies and better, boxes bogeys and worse, leaves par bare", () => {
    expect(mark(4, 2)).toBe("eagle");
    expect(mark(5, 2)).toBe("eagle");
    expect(mark(4, 3)).toBe("birdie");
    expect(mark(4, 4)).toBe("par");
    expect(mark(4, 5)).toBe("bogey");
    expect(mark(4, 6)).toBe("double");
    expect(mark(4, 9)).toBe("double");
  });

  it("a hole with no par carries no mark — never one we cannot justify", () => {
    expect(mark(null, 6)).toBe("none");
  });
});

describe("round listing — the expansion footer IS the aggregate rollup at n=1", () => {
  const carillon = loadCarillonRound();
  const footer = computeStats([carillon])!;

  it("the rollup runs unchanged over a single round", () => {
    expect(footer.rounds).toBe(1);
  });

  it("GIR 61.1% · fairways 50.0% · 31 putts · 0 doubles+ (the design draft's figures)", () => {
    expect(footer.girPct).toBe(61.1);
    expect(footer.fairways!.hitPct).toBe(50.0);
    expect(footer.putting!.avgPutts).toBe(31);
    expect(footer.distribution.doubleOrWorse).toBe(0);
  });

  it("par 3 / 4 / 5 read −0.25 / +0.20 / +0.25, signed to two decimals", () => {
    expect(formatSignedDelta(footer.parType.par3!)).toBe("-0.25");
    expect(formatSignedDelta(footer.parType.par4!)).toBe("+0.20");
    expect(formatSignedDelta(footer.parType.par5!)).toBe("+0.25");
  });

  it("at n=1 the putts and doubles+ figures are the round's own counts, not averages", () => {
    const { front, back } = splitNines(carillon);
    expect(footer.putting!.avgPutts).toBe(front!.putts! + back!.putts!);
  });

  it("a one-round window's cards and that round's footer are the same numbers", () => {
    // The anti-drift property: the listing calls the SAME function the cards
    // do, so a YTD window holding one round cannot disagree with its own row.
    const cards = computeStats(selectWindow([carillon], "ytd", 2026))!;
    expect(cards).toEqual(footer);
  });
});

describe("round listing — window ordering is selectWindow's, not a second sort", () => {
  it("Last 20 and YTD hand the list reverse-chronological rounds, newest first", () => {
    const rounds = [
      mkRound("2026-05-13", 11.2),
      mkRound("2026-08-22", 3.1),
      mkRound("2026-06-22", 8.7),
    ];
    for (const w of ["last20", "ytd"] as const) {
      expect(selectWindow(rounds, w, 2026).map((r) => r.playedDate)).toEqual([
        "2026-08-22",
        "2026-06-22",
        "2026-05-13",
      ]);
    }
  });

  it("Hcp 8 hands the list its rounds by differential ascending — best first", () => {
    const rounds = [
      mkRound("2026-05-13", 11.2),
      mkRound("2026-08-22", 3.1),
      mkRound("2026-06-22", 8.7),
    ];
    const win = selectWindow(rounds, "hcp8", 2026);
    expect(win.map((r) => r.differential)).toEqual([3.1, 8.7, 11.2]);
    // The bottom row is the worst counting round — the number to beat.
    expect(win[win.length - 1]!.differential).toBe(11.2);
  });
});
