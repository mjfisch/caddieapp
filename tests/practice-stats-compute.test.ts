import { describe, it, expect } from "vitest";
import {
  computePracticeStats,
  selectPracticeWindow,
  weekStart,
  shortDate,
  PRACTICE_WINDOWS,
  type PracticeMetricDef,
  type PracticeStatsSession,
  type PracticeDrillBlock,
} from "../apps/web/src/app/stats/computePracticeStats";

// =============================================================
// Mission S8 - the practice derivation module, pinned to synthetic fixtures.
//
// Deliberately synthetic rather than DB-backed: the module is pure and must be
// provable without credentials, and the interesting cases (a zero week, a
// drill nobody has seeded yet, a session dated exactly on a window boundary)
// do not all exist in the live data.
//
// NOTE: this file is ASCII only on purpose. The repo's test runner has a known
// esbuild parse quirk that chokes on em-dash characters in comments, which is
// what breaks tests/migration-manifest.test.ts and tests/rounds-manifest.test.ts
// on main today. Do not paste typographic punctuation in here.
// =============================================================

// ---- Fixture builders -------------------------------------------------------

function session(
  date: string,
  type: string,
  extra: Partial<PracticeStatsSession> = {},
): PracticeStatsSession {
  // `extra` is spread last, so a caller passing `id` replaces this default outright.
  return {
    id: `${date}-${type}`,
    date,
    type,
    durationMin: null,
    lieTypes: [],
    shotTypes: [],
    clubs: [],
    blocks: [],
    ...extra,
  };
}

function block(drillTitle: string, position: number, values: Record<string, number>): PracticeDrillBlock {
  return {
    drillTitle,
    position,
    values: Object.entries(values).map(([label, value]) => ({ label, value })),
  };
}

/**
 * The three seeded putting drills' metric defs (009_practice_redesign_schema),
 * plus "Clock Drill" - a drill that does NOT exist in the app today. It is here
 * to prove drills are discovered from logged values rather than hardcoded.
 */
const METRIC_DEFS: PracticeMetricDef[] = [
  { drillTitle: "Gate Drill (MJF variant)", label: "Resets", valueType: "integer", unit: null, better: "lower", sortOrder: 0 },
  { drillTitle: "Lag Ladder", label: "Distance", valueType: "integer", unit: "ft", better: null, sortOrder: 0 },
  { drillTitle: "Lag Ladder", label: "Balls", valueType: "integer", unit: null, better: null, sortOrder: 1 },
  { drillTitle: "Lag Ladder", label: "3-putts", valueType: "integer", unit: null, better: "lower", sortOrder: 2 },
  { drillTitle: "Circle Drill", label: "Distance", valueType: "integer", unit: "ft", better: null, sortOrder: 0 },
  { drillTitle: "Circle Drill", label: "Balls", valueType: "integer", unit: null, better: null, sortOrder: 1 },
  { drillTitle: "Circle Drill", label: "Makes", valueType: "integer", unit: null, better: "higher", sortOrder: 2 },
  { drillTitle: "Clock Drill", label: "Distance", valueType: "integer", unit: "ft", better: null, sortOrder: 0 },
  { drillTitle: "Clock Drill", label: "Balls", valueType: "integer", unit: null, better: null, sortOrder: 1 },
  { drillTitle: "Clock Drill", label: "Makes", valueType: "integer", unit: null, better: "higher", sortOrder: 2 },
];

// ---- a. Outing grouping -----------------------------------------------------

describe("outing grouping: an outing is one calendar date, not one row", () => {
  // Jun 1 is a single session; Jun 3 is a three-session range trip; Jun 8 is two.
  const sessions = [
    session("2026-06-01", "trackman"),
    session("2026-06-03", "trackman", { id: "a" }),
    session("2026-06-03", "around_green", { id: "b" }),
    session("2026-06-03", "putting", { id: "c" }),
    session("2026-06-08", "grass_range", { id: "d" }),
    session("2026-06-08", "putting", { id: "e" }),
  ];
  const stats = computePracticeStats(sessions, METRIC_DEFS)!;

  it("collapses same-date sessions into one outing", () => {
    expect(stats.sessions).toBe(6);
    expect(stats.outings).toBe(3);
  });

  it("counts a three-block range day as ONE weekly bar unit, not three", () => {
    // Jun 1 and Jun 3 share the week of Jun 1 (a Monday); Jun 8 opens the next.
    expect(stats.weeklyBars).toEqual([
      { weekStart: "2026-06-01", outings: 2 },
      { weekStart: "2026-06-08", outings: 1 },
    ]);
  });

  it("divides outings by ELAPSED weeks, not by calendar weeks touched", () => {
    // Jun 1 to Jun 8 is exactly 7 days = 1.0 elapsed week, across 2 calendar weeks.
    expect(stats.weeksElapsed).toBe(1);
    expect(stats.outingsPerWeek).toBe(3);
  });

  it("two same-day visits collapse - the accepted cost of a derived grouping", () => {
    const twice = computePracticeStats(
      [session("2026-06-01", "putting", { id: "morning" }), session("2026-06-01", "putting", { id: "evening" })],
      METRIC_DEFS,
    )!;
    expect(twice.sessions).toBe(2);
    expect(twice.outings).toBe(1);
  });

  it("floors the rate denominator at one week so a single outing cannot divide by zero", () => {
    const one = computePracticeStats([session("2026-06-01", "putting")], METRIC_DEFS)!;
    expect(one.weeksElapsed).toBe(1);
    expect(one.outingsPerWeek).toBe(1);
  });
});

// ---- b. Weekly bars ---------------------------------------------------------

describe("weekly bars", () => {
  it("emits every week between the first and last outing, including empty ones", () => {
    const stats = computePracticeStats(
      [session("2026-06-01", "putting"), session("2026-06-22", "putting", { id: "z" })],
      METRIC_DEFS,
    )!;
    expect(stats.weeklyBars).toEqual([
      { weekStart: "2026-06-01", outings: 1 },
      { weekStart: "2026-06-08", outings: 0 },
      { weekStart: "2026-06-15", outings: 0 },
      { weekStart: "2026-06-22", outings: 1 },
    ]);
  });

  it("buckets on Monday-start calendar weeks", () => {
    expect(weekStart("2026-06-01")).toBe("2026-06-01"); // a Monday
    expect(weekStart("2026-06-07")).toBe("2026-06-01"); // Sunday belongs to the prior week
    expect(weekStart("2026-06-08")).toBe("2026-06-08");
    expect(weekStart("2026-07-29")).toBe("2026-07-27");
  });
});

// ---- c. Putting embed rate --------------------------------------------------

describe("putting embed rate", () => {
  const sessions = [
    session("2026-06-01", "trackman"),
    session("2026-06-03", "trackman", { id: "a" }),
    session("2026-06-03", "putting", { id: "b" }),
    session("2026-06-05", "putting", { id: "c" }),
    session("2026-06-05", "putting", { id: "d" }),
    session("2026-06-09", "around_green"),
  ];
  const stats = computePracticeStats(sessions, METRIC_DEFS)!;

  it("counts OUTINGS that include at least one putting session, not putting sessions", () => {
    // Three putting sessions, but only two outings carried putting work.
    expect(stats.puttingEmbed).toEqual({ outingsWithPutting: 2, outings: 4 });
  });
});

// ---- a. Duration coverage ---------------------------------------------------

describe("partial duration coverage", () => {
  const sessions = [
    session("2026-06-01", "putting", { durationMin: 45 }),
    session("2026-06-03", "trackman", { durationMin: 60, id: "a" }),
    session("2026-06-03", "putting", { durationMin: null, id: "b" }),
    session("2026-06-05", "around_green", { durationMin: null }),
  ];
  const stats = computePracticeStats(sessions, METRIC_DEFS)!;

  it("sums only the sessions that carry a duration", () => {
    expect(stats.duration.totalMin).toBe(105);
    expect(stats.duration.hours).toBe(1.8);
  });

  it("always reports coverage alongside the total, never implying completeness", () => {
    expect(stats.duration.withDuration).toBe(2);
    expect(stats.duration.ofSessions).toBe(4);
  });

  it("reports a zero total with zero coverage rather than hiding the group", () => {
    const none = computePracticeStats([session("2026-06-01", "putting")], METRIC_DEFS)!;
    expect(none.duration).toEqual({ totalMin: 0, hours: 0, withDuration: 0, ofSessions: 1 });
  });
});

// ---- Window boundaries ------------------------------------------------------

describe("window boundaries on practice_session.date", () => {
  const TODAY = "2026-08-03";
  // 4W is the 28 days ending today: 2026-07-07 through 2026-08-03 inclusive.
  // 12W is the 84 days ending today: 2026-05-12 through 2026-08-03 inclusive.
  const sessions = [
    session("2025-12-31", "putting", { id: "last-year" }),
    session("2026-01-01", "putting", { id: "year-open" }),
    session("2026-05-11", "putting", { id: "12w-outside" }),
    session("2026-05-12", "putting", { id: "12w-edge" }),
    session("2026-07-06", "putting", { id: "4w-outside" }),
    session("2026-07-07", "putting", { id: "4w-edge" }),
    session("2026-08-03", "putting", { id: "today" }),
    session("2026-08-04", "putting", { id: "future" }),
  ];

  const ids = (w: (typeof PRACTICE_WINDOWS)[number]) =>
    selectPracticeWindow(sessions, w, TODAY).map((s) => s.id);

  it("4W includes the 28th day back and excludes the 29th", () => {
    expect(ids("4w")).toEqual(["today", "4w-edge"]);
  });

  it("12W includes the 84th day back and excludes the 85th", () => {
    expect(ids("12w")).toEqual(["today", "4w-edge", "4w-outside", "12w-edge"]);
  });

  it("YTD is the calendar year of today, so it excludes December of the prior year", () => {
    const ytd = ids("ytd");
    expect(ytd).toContain("year-open");
    expect(ytd).not.toContain("last-year");
    expect(ytd).not.toContain("future");
  });

  it("never includes a session dated after today, in any window", () => {
    for (const w of PRACTICE_WINDOWS) {
      expect(ids(w)).not.toContain("future");
    }
  });

  it("returns sessions newest first", () => {
    const picked = selectPracticeWindow(sessions, "12w", TODAY);
    const dates = picked.map((s) => s.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("an empty window derives to null, not to zeroed placeholder numbers", () => {
    expect(computePracticeStats(selectPracticeWindow([], "4w", TODAY), METRIC_DEFS)).toBeNull();
  });
});

// ---- d. Session mix, including legacy ---------------------------------------

describe("legacy short_game sessions count in volume and mix but carry no structure", () => {
  const sessions = [
    session("2026-06-01", "short_game", { durationMin: 30 }),
    session("2026-06-02", "short_game", { durationMin: null, id: "b" }),
    session("2026-06-03", "putting", { blocks: [block("Lag Ladder", 0, { Distance: 30, Balls: 10, "3-putts": 1 })] }),
    session("2026-06-04", "trackman", { clubs: ["7i"] }),
  ];
  const stats = computePracticeStats(sessions, METRIC_DEFS)!;

  it("counts legacy rows in sessions, outings, and duration coverage", () => {
    expect(stats.sessions).toBe(4);
    expect(stats.outings).toBe(4);
    expect(stats.duration.withDuration).toBe(1);
  });

  it("labels them 'legacy' and flags them, rather than dropping or renaming the type", () => {
    const legacy = stats.mix.find((m) => m.type === "short_game")!;
    expect(legacy).toEqual({ type: "short_game", label: "legacy", count: 2, legacy: true });
  });

  it("sorts live types first and legacy last, regardless of count", () => {
    expect(stats.mix.map((m) => m.type)).toEqual(["putting", "trackman", "short_game"]);
  });

  it("contributes nothing structured: no drill blocks, no tags, no clubs", () => {
    // Only the putting session's Lag Ladder block produced a card.
    expect(stats.drills.map((d) => d.drillTitle)).toEqual(["Lag Ladder"]);
    expect(stats.aroundGreen.sessions).toBe(0);
    expect(stats.clubTagTotal).toBe(1);
  });

  it("mix counts always sum to the session total", () => {
    expect(stats.mix.reduce((sum, m) => sum + m.count, 0)).toBe(stats.sessions);
  });
});

// ---- e. Drill points carry their parameter ----------------------------------

describe("Lag Ladder: every point carries the Distance it was logged at", () => {
  const sessions = [
    session("2026-07-08", "putting", { blocks: [block("Lag Ladder", 0, { Distance: 30, Balls: 10, "3-putts": 1 })] }),
    session("2026-07-10", "putting", { blocks: [block("Lag Ladder", 0, { Distance: 30, Balls: 10, "3-putts": 2 })] }),
    session("2026-07-15", "putting", { blocks: [block("Lag Ladder", 0, { Distance: 35, Balls: 10, "3-putts": 0 })] }),
    session("2026-07-21", "putting", { blocks: [block("Lag Ladder", 0, { Distance: 50, Balls: 10, "3-putts": 2 })] }),
    session("2026-07-29", "putting", { blocks: [block("Lag Ladder", 0, { Distance: 25, Balls: 10, "3-putts": 0 })] }),
  ];
  const card = computePracticeStats(sessions, METRIC_DEFS)!.drills.find((d) => d.drillTitle === "Lag Ladder")!;

  it("attaches a non-null parameter to EVERY point", () => {
    expect(card.points.every((p) => p.parameter != null)).toBe(true);
  });

  it("plots chronologically with the distance riding along", () => {
    expect(card.points.map((p) => [p.date, p.value, p.parameter])).toEqual([
      ["2026-07-08", 1, 30],
      ["2026-07-10", 2, 30],
      ["2026-07-15", 0, 35],
      ["2026-07-21", 2, 50],
      ["2026-07-29", 0, 25],
    ]);
  });

  it("identifies the scored metric and its direction from drill_metric_def", () => {
    expect(card.primaryLabel).toBe("3-putts");
    expect(card.better).toBe("lower");
    expect(card.parameterLabel).toBe("Distance");
    expect(card.parameterUnit).toBe("ft");
  });

  it("marks only the window's worst values adverse, so a 0 at 25ft never outranks a 2 at 50ft", () => {
    // The two 2s are adverse; the 1 at 30 ft is not, and neither are the 0s.
    expect(card.points.map((p) => p.adverse)).toEqual([false, true, false, true, false]);
  });

  it("exposes the latest block WITH its parameter context", () => {
    expect(card.latest).toEqual({ date: "2026-07-29", value: 0, parameter: 25, adverse: false });
  });

  it("plots points rather than a strip once the metric is not binary", () => {
    expect(card.render).toBe("trend");
  });

  it("reports the constant Balls denominator", () => {
    expect(card.denominator).toBe(10);
  });

  it("withholds the denominator when it moved during the window", () => {
    const mixed = computePracticeStats(
      [
        session("2026-07-08", "putting", { blocks: [block("Lag Ladder", 0, { Distance: 30, Balls: 10, "3-putts": 1 })] }),
        session("2026-07-10", "putting", { blocks: [block("Lag Ladder", 0, { Distance: 30, Balls: 6, "3-putts": 1 })] }),
      ],
      METRIC_DEFS,
    )!.drills[0]!;
    expect(mixed.denominator).toBeNull();
  });
});

describe("Circle Drill: distinct distances become the color legend", () => {
  const sessions = [
    session("2026-07-08", "putting", { blocks: [block("Circle Drill", 0, { Distance: 10, Balls: 10, Makes: 5 })] }),
    session("2026-07-15", "putting", { blocks: [block("Circle Drill", 0, { Distance: 15, Balls: 10, Makes: 4 })] }),
    session("2026-07-29", "putting", { blocks: [block("Circle Drill", 0, { Distance: 10, Balls: 10, Makes: 1 })] }),
  ];
  const card = computePracticeStats(sessions, METRIC_DEFS)!.drills[0]!;

  it("collects the distinct parameter values present, ascending", () => {
    expect(card.parameterValues).toEqual([10, 15]);
  });

  it("scores a higher-is-better metric without marking anything adverse", () => {
    expect(card.better).toBe("higher");
    expect(card.points.every((p) => p.adverse === false)).toBe(true);
  });
});

// ---- e. Gate Drill strip ----------------------------------------------------

describe("Gate Drill: a binary metric renders as a strip, oldest to newest", () => {
  const values = [1, 0, 0, 0, 1, 0, 1, 0];
  const dates = [
    "2026-07-08", "2026-07-10", "2026-07-14", "2026-07-15",
    "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-29",
  ];
  // Deliberately fed newest-first, to prove the module orders the strip itself.
  const sessions = dates
    .map((d, i) => session(d, "putting", { blocks: [block("Gate Drill (MJF variant)", 0, { Resets: values[i] as number })] }))
    .reverse();
  const card = computePracticeStats(sessions, METRIC_DEFS)!.drills.find((d) => d.drillTitle.startsWith("Gate"))!;

  it("chooses the strip renderer over a trendline for 0/1 values", () => {
    expect(card.render).toBe("strip");
  });

  it("orders cells oldest to newest regardless of input order", () => {
    expect(card.points.map((p) => p.date)).toEqual(dates);
    expect(card.points.map((p) => p.value)).toEqual(values);
  });

  it("greens a zero and corals any reset, per the Gate rule", () => {
    expect(card.points.map((p) => p.adverse)).toEqual([true, false, false, false, true, false, true, false]);
  });

  it("summarises 'N clean of M'", () => {
    expect(card.cleanCount).toBe(5);
    expect(card.blocks).toBe(8);
  });

  it("has no parameter to carry, and says so rather than inventing one", () => {
    expect(card.parameterLabel).toBeNull();
    expect(card.points.every((p) => p.parameter === null)).toBe(true);
  });

  it("switches to a trend as soon as a value exceeds the binary range", () => {
    const withThree = computePracticeStats(
      [
        session("2026-07-08", "putting", { blocks: [block("Gate Drill (MJF variant)", 0, { Resets: 0 })] }),
        session("2026-07-10", "putting", { blocks: [block("Gate Drill (MJF variant)", 0, { Resets: 3 })] }),
      ],
      METRIC_DEFS,
    )!.drills[0]!;
    expect(withThree.render).toBe("trend");
  });
});

// ---- e. Dynamic drill discovery ---------------------------------------------

describe("drills are discovered from the data, not hardcoded", () => {
  const sessions = [
    session("2026-07-08", "putting", {
      blocks: [
        block("Clock Drill", 0, { Distance: 6, Balls: 12, Makes: 9 }),
        block("Lag Ladder", 1, { Distance: 30, Balls: 10, "3-putts": 0 }),
      ],
    }),
    session("2026-07-15", "putting", {
      id: "b",
      blocks: [block("Clock Drill", 0, { Distance: 6, Balls: 12, Makes: 11 })],
    }),
  ];
  const stats = computePracticeStats(sessions, METRIC_DEFS)!;

  it("gives a card to a drill that is not one of the three currently seeded", () => {
    const clock = stats.drills.find((d) => d.drillTitle === "Clock Drill");
    expect(clock).toBeDefined();
    expect(clock!.blocks).toBe(2);
    expect(clock!.primaryLabel).toBe("Makes");
    expect(clock!.better).toBe("higher");
    expect(clock!.denominator).toBe(12);
    expect(clock!.parameterUnit).toBe("ft");
  });

  it("orders cards by how much work they actually hold", () => {
    expect(stats.drills.map((d) => d.drillTitle)).toEqual(["Clock Drill", "Lag Ladder"]);
  });

  it("emits no card for a drill with no logged values in the window", () => {
    expect(stats.drills.map((d) => d.drillTitle)).not.toContain("Circle Drill");
  });

  it("skips a drill whose metric defs carry no direction, rather than guessing one", () => {
    const unscored: PracticeMetricDef[] = [
      { drillTitle: "General", label: "Note", valueType: "integer", unit: null, better: null, sortOrder: 0 },
    ];
    const stats2 = computePracticeStats(
      [session("2026-07-08", "putting", { blocks: [block("General", 0, { Note: 3 })] })],
      unscored,
    )!;
    expect(stats2.drills).toEqual([]);
  });

  it("ignores a note-only block: it records the work, it is not a datapoint", () => {
    const noteOnly = computePracticeStats(
      [session("2026-07-08", "putting", { blocks: [{ drillTitle: "Lag Ladder", position: 0, values: [] }] })],
      METRIC_DEFS,
    )!;
    expect(noteOnly.drills).toEqual([]);
    expect(noteOnly.puttingSessions).toBe(1);
  });

  it("orders blocks within one session by position", () => {
    const twoInOneDay = computePracticeStats(
      [
        session("2026-07-08", "putting", {
          blocks: [
            block("Lag Ladder", 1, { Distance: 50, Balls: 10, "3-putts": 0 }),
            block("Lag Ladder", 0, { Distance: 20, Balls: 10, "3-putts": 0 }),
          ],
        }),
      ],
      METRIC_DEFS,
    )!.drills[0]!;
    expect(twoInOneDay.points.map((p) => p.parameter)).toEqual([20, 50]);
  });
});

// ---- f. Around the green ----------------------------------------------------

describe("around the green: zero-count vocabulary entries still render", () => {
  const sessions = [
    session("2026-07-10", "around_green", { lieTypes: ["tight", "short rough"], shotTypes: ["chipping"] }),
    session("2026-07-22", "around_green", { id: "b", lieTypes: ["short rough"], shotTypes: ["chipping", "flops"] }),
    session("2026-07-23", "putting", { lieTypes: ["deep rough"] }),
  ];
  const stats = computePracticeStats(sessions, METRIC_DEFS)!;

  it("counts tags across around_green sessions only", () => {
    expect(stats.aroundGreen.sessions).toBe(2);
    // The putting session's stray lie tag is not an around-green fact.
    expect(stats.aroundGreen.lies.find((t) => t.tag === "deep rough")!.count).toBe(0);
  });

  it("keeps a muted zero chip for a vocabulary entry nobody logged", () => {
    expect(stats.aroundGreen.lies.find((t) => t.tag === "bunker")).toEqual({ tag: "bunker", count: 0 });
    expect(stats.aroundGreen.shots.find((t) => t.tag === "bunker")).toEqual({ tag: "bunker", count: 0 });
  });

  it("renders the whole form vocabulary on both axes", () => {
    expect(stats.aroundGreen.lies.map((t) => t.tag).sort()).toEqual(
      ["bunker", "deep rough", "short rough", "tight"],
    );
    expect(stats.aroundGreen.shots.map((t) => t.tag).sort()).toEqual(
      ["bunker", "chipping", "flops", "pitching"],
    );
  });

  it("sorts by count, busiest tag first", () => {
    expect(stats.aroundGreen.lies[0]).toEqual({ tag: "short rough", count: 2 });
  });
});

// ---- g. Clubs worked --------------------------------------------------------

describe("clubs worked", () => {
  const sessions = [
    session("2026-07-10", "trackman", { clubs: ["7i", "8i", "LW60"] }),
    session("2026-07-22", "around_green", { id: "b", clubs: ["LW60", "SW54"] }),
    session("2026-07-23", "grass_range", { clubs: ["LW60", "7i"] }),
  ];
  const stats = computePracticeStats(sessions, METRIC_DEFS)!;

  it("counts one tag per club per session and totals them", () => {
    expect(stats.clubs.slice(0, 2)).toEqual([
      { tag: "LW60", count: 3 },
      { tag: "7i", count: 2 },
    ]);
    expect(stats.clubTagTotal).toBe(7);
  });
});

// ---- Display helper ---------------------------------------------------------

describe("shortDate", () => {
  it("renders a compact point label without leading zeros", () => {
    expect(shortDate("2026-07-21")).toBe("7/21");
    expect(shortDate("2026-11-05")).toBe("11/5");
  });
});
