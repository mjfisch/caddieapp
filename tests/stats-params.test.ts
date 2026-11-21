import { describe, it, expect } from "vitest";
import {
  buildStatsQuery,
  parseStatsParams,
} from "../apps/web/src/app/stats/statsParams";
import { statsWindowLabel } from "../apps/web/src/app/stats/computeStats";

// =============================================================
// D31 — the /stats URL contract and the honest window label. Pure, no DB.
// =============================================================

const DEFAULTS = { view: "rounds", roundsWindow: "last20", practiceWindow: "4w" } as const;

describe("parseStatsParams", () => {
  it("no params → today's defaults", () => {
    expect(parseStatsParams({})).toEqual(DEFAULTS);
  });

  it("view=practice opens practice, window applies to it", () => {
    expect(parseStatsParams({ view: "practice" })).toEqual({ ...DEFAULTS, view: "practice" });
    expect(parseStatsParams({ view: "practice", window: "12w" })).toEqual({
      ...DEFAULTS,
      view: "practice",
      practiceWindow: "12w",
    });
  });

  it("window selects the rounds window when view is rounds or missing", () => {
    expect(parseStatsParams({ window: "hcp8" }).roundsWindow).toBe("hcp8");
    expect(parseStatsParams({ view: "rounds", window: "ytd" }).roundsWindow).toBe("ytd");
  });

  it("invalid / cross-view values fall back to defaults", () => {
    expect(parseStatsParams({ view: "bag", window: "nope" })).toEqual(DEFAULTS);
    // 12w is a practice window, not a rounds one.
    expect(parseStatsParams({ window: "12w" })).toEqual(DEFAULTS);
    // last20 is a rounds window, not a practice one.
    expect(parseStatsParams({ view: "practice", window: "last20" }).practiceWindow).toBe("4w");
    expect(parseStatsParams({ view: "PRACTICE" }).view).toBe("rounds");
  });

  it("repeated params use the first value", () => {
    expect(parseStatsParams({ view: ["practice", "rounds"], window: ["ytd", "4w"] })).toEqual({
      ...DEFAULTS,
      view: "practice",
      practiceWindow: "ytd",
    });
  });
});

describe("buildStatsQuery", () => {
  it("defaults → empty query (plain /stats)", () => {
    expect(buildStatsQuery(DEFAULTS)).toBe("");
  });

  it("writes only non-default view / active window", () => {
    expect(buildStatsQuery({ ...DEFAULTS, roundsWindow: "ytd" })).toBe("?window=ytd");
    expect(buildStatsQuery({ ...DEFAULTS, view: "practice" })).toBe("?view=practice");
    expect(buildStatsQuery({ ...DEFAULTS, view: "practice", practiceWindow: "12w" })).toBe(
      "?view=practice&window=12w",
    );
    // The inactive view's window is not written.
    expect(buildStatsQuery({ ...DEFAULTS, view: "practice", roundsWindow: "hcp8" })).toBe(
      "?view=practice",
    );
  });

  it("round-trips through parseStatsParams", () => {
    for (const s of [
      DEFAULTS,
      { ...DEFAULTS, roundsWindow: "hcp8" },
      { ...DEFAULTS, view: "practice", practiceWindow: "ytd" },
    ] as const) {
      const q = Object.fromEntries(new URLSearchParams(buildStatsQuery(s)));
      expect(parseStatsParams(q)).toEqual(s);
    }
  });
});

describe("statsWindowLabel", () => {
  it("a short Last 20 says how many rounds it really holds", () => {
    expect(statsWindowLabel("last20", 19)).toBe("Last 20 · 19");
    expect(statsWindowLabel("last20", 0)).toBe("Last 20 · 0");
  });

  it("a full window keeps the plain label", () => {
    expect(statsWindowLabel("last20", 20)).toBe("Last 20");
    expect(statsWindowLabel("hcp8", 8)).toBe("Hcp 8");
  });

  it("a short Hcp 8 is flagged too; YTD has no nominal size", () => {
    expect(statsWindowLabel("hcp8", 5)).toBe("Hcp 8 · 5");
    expect(statsWindowLabel("ytd", 3)).toBe("YTD");
  });
});
