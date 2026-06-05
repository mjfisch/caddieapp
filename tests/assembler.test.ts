import { describe, it, expect } from "vitest";
import type { HoleInput, StrategyResult } from "@gai/sg-engine";
import {
  assemblePrompt,
  buildCourseHoleLayer,
  CORE_RULES,
} from "@gai/caddie-context";

// ── Fixtures ──────────────────────────────────────────────────────────────────

// A clean approach hole — every number here is traceable, used by the no-fabrication test.
const HOLE: HoleInput = {
  number: 7,
  par: 4,
  strokeIndex: 8,
  yardageWhite: 150,
  features: [{ kind: "bunker", side: "right", distanceFromTee: 140, carryToClear: null }],
};

const RESULT: StrategyResult = {
  recommendedClub: "8i",
  carryTarget: 150,
  dangerSide: "left",
  layupRecommended: false,
  expectedStrokes: 2.98,
  confidenceFlag: "measured",
  reasoning: ["8i carries to 150, over the bunker at 140", "center of the green is the play"],
};

const HEADERS = [
  "## LAYER 1 — CORE RULES",
  "## LAYER 2 — COURSE & HOLE",
  "## LAYER 3 — PLAYER PROFILE",
  "## LAYER 4 — PERSONA VOICE",
  "## LAYER 5 — LIVE INPUT",
];

/** Pull every run of digits out of a string as integers. */
const ints = (s: string) => (s.match(/\d+/g) ?? []).map(Number);

describe("Phase 3A — five-layer assembler", () => {
  it("1. layer order: all five ## LAYER headers appear in the correct sequence", () => {
    const prompt = assemblePrompt(HOLE, RESULT, "rain_man", "Fox Bend", "White", {
      pinPosition: "middle",
    });
    const positions = HEADERS.map((h) => prompt.indexOf(h));
    for (const p of positions) expect(p).toBeGreaterThanOrEqual(0);
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });

  it("2. no fabricated numbers: every integer in the prompt traces to the hole or result", () => {
    const prompt = assemblePrompt(HOLE, RESULT, "rain_man", "Fox Bend", "White", {
      // No numeric conditions — Layer 5 must add no foreign figures here.
      pinPosition: "middle",
      lie: "fairway",
    });

    // The structural "## LAYER N" headers are scaffolding, not yardages — drop them.
    const body = prompt
      .split("\n")
      .filter((line) => !line.startsWith("## LAYER"))
      .join("\n");

    // Allowed source numbers: anything present in the hole or the engine result.
    const allowed = new Set([...ints(JSON.stringify(HOLE)), ...ints(JSON.stringify(RESULT))]);

    for (const n of ints(body)) {
      expect(allowed.has(n), `prompt contains integer ${n} not present in HoleInput or StrategyResult`).toBe(true);
    }
  });

  it("3. persona isolation: swapping rain_man -> the_ringer changes only Layer 4", () => {
    const args = ["Fox Bend", "White", { pinPosition: "middle" as const }] as const;
    const a = assemblePrompt(HOLE, RESULT, "rain_man", ...args);
    const b = assemblePrompt(HOLE, RESULT, "the_ringer", ...args);

    // Split into the five layer chunks (parts[0] is the empty pre-header lead-in).
    const a4 = a.split(/^## LAYER /m);
    const b4 = b.split(/^## LAYER /m);
    expect(a4.length).toBe(6);
    expect(b4.length).toBe(6);

    expect(a4[1]).toBe(b4[1]); // Layer 1 — core rules
    expect(a4[2]).toBe(b4[2]); // Layer 2 — course & hole
    expect(a4[3]).toBe(b4[3]); // Layer 3 — player profile
    expect(a4[4]).not.toBe(b4[4]); // Layer 4 — persona voice (the only change)
    expect(a4[5]).toBe(b4[5]); // Layer 5 — live input (+ footer)
  });

  it("4. Layer 1 immutability: CORE_RULES appears verbatim, unaltered by lower layers", () => {
    const prompt = assemblePrompt(HOLE, RESULT, "captain_69", "Fox Bend", "White", {
      pinPosition: "back",
    });
    expect(prompt.includes(CORE_RULES)).toBe(true);
  });

  it("5. confidence language tracks the data flag", () => {
    const seeded = buildCourseHoleLayer(
      { ...HOLE },
      { ...RESULT, confidenceFlag: "seeded" },
      "Fox Bend",
      "White",
    );
    expect(/placeholder|seeded/.test(seeded)).toBe(true);

    const measured = buildCourseHoleLayer(
      { ...HOLE },
      { ...RESULT, confidenceFlag: "measured" },
      "Fox Bend",
      "White",
    );
    for (const hedge of ["estimate", "approximately", "around"]) {
      expect(measured.includes(hedge), `measured Layer 2 must not hedge with "${hedge}"`).toBe(false);
    }
  });

  it("6. Fox Bend Hole 3 full assembly smoke test (Rain Man)", () => {
    const hole3: HoleInput = {
      number: 3,
      par: 3,
      strokeIndex: 16,
      yardageWhite: 150,
      features: [
        { kind: "water", side: "left", distanceFromTee: null, carryToClear: 160 },
        { kind: "water", side: "right", distanceFromTee: null, carryToClear: 160 },
      ],
    };
    // The StrategyResult shape from the Phase 2B smoke test: 8i layup, 150 carry,
    // danger left, measured.
    const result: StrategyResult = {
      recommendedClub: "8i",
      carryTarget: 150,
      dangerSide: "left",
      layupRecommended: true,
      expectedStrokes: 3.0,
      confidenceFlag: "measured",
      reasoning: ["8i to 150 is the safe two-putt target", "water both sides — center is the play"],
    };

    const prompt = assemblePrompt(hole3, result, "rain_man", "Fox Bend", "White", {
      windMph: 10,
      windDir: "into",
      pinPosition: "middle",
    });

    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(200);
    expect(prompt.includes("8")).toBe(true); // the club (8i)
    expect(prompt.includes("150")).toBe(true); // the carry target
    expect(prompt.includes("left")).toBe(true); // the danger side
  });
});
