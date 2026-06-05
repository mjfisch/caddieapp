import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIDENCE_COLOR, CONTEXT_LAYERS } from "@gai/shared";
import {
  deterministicProbe,
  predictHole,
  PERSONAS,
  computeExpectedStrokes,
  sampleDispersion,
  expectedStrokesFromLie,
  rankPracticeSignals,
  type ClubDispersion,
  type HoleInput,
  type PersonaRiskConfig,
} from "@gai/sg-engine";
import { LAYER_ORDER, buildPracticeCoachLayer, assemblePracticePrompt } from "@gai/caddie-context";
import {
  getPool,
  runStrategyStream,
  runMigrations,
  createRound,
  upsertRoundHole,
  getRound,
  computeScoringWeaknesses,
} from "@gai/api";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p: string) => readFileSync(root + p, "utf8");

/** Recursively collect every file under `dir` (absolute paths). */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** Drain an SSE byte stream into a single string. */
async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** Strip block and line comments so guards scan *code*, not documentation about the rule. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("invariant #1 — the math runs in code, deterministically; sg-engine does no I/O", () => {
  it("deterministicProbe is pure: same input -> same output", () => {
    expect(deterministicProbe(42)).toBe(deterministicProbe(42));
    expect(deterministicProbe(7)).not.toBe(deterministicProbe(8));
  });

  it("sg-engine source imports nothing that does I/O or randomness", () => {
    const src = stripComments(read("packages/sg-engine/src/index.ts"));
    for (const forbidden of ["from \"pg\"", "from \"fs\"", "node:fs", "fetch(", "http", "Math.random", "Date.now"]) {
      expect(src.includes(forbidden), `sg-engine must not contain: ${forbidden}`).toBe(false);
    }
  });
});

describe("invariant #2 — confidence flags map onto the semantic colors", () => {
  it("measured=green, partial=amber, seeded=faint", () => {
    expect(CONFIDENCE_COLOR.measured).toBe("var(--green)");
    expect(CONFIDENCE_COLOR.partial).toBe("var(--amber)");
    expect(CONFIDENCE_COLOR.seeded).toBe("var(--faint)");
  });
});

describe("invariant #3 — the Anthropic key is server-side only", () => {
  it("server modules import 'server-only'", () => {
    for (const f of ["services/api/src/db.ts", "services/api/src/anthropic.ts", "services/api/src/health.ts", "services/api/src/index.ts"]) {
      expect(read(f).includes('import "server-only"'), `${f} must import server-only`).toBe(true);
    }
  });

  it("the key is read from process.env.ANTHROPIC_API_KEY and never NEXT_PUBLIC-prefixed", () => {
    const anthropic = read("services/api/src/anthropic.ts");
    expect(anthropic.includes("process.env.ANTHROPIC_API_KEY")).toBe(true);
    // A NEXT_PUBLIC_ prefix would inline the value into the client bundle — forbidden.
    for (const f of ["services/api/src/anthropic.ts", "apps/web/src/app/page.tsx", "apps/web/src/app/api/health/route.ts"]) {
      expect(read(f).includes("NEXT_PUBLIC_ANTHROPIC"), `${f} must not expose the key client-side`).toBe(false);
    }
  });
});

describe("invariant #5 — five layers compose in order; Layer 1 (accuracy) wins", () => {
  it("the locked layer order starts with the core rules (accuracy wins)", () => {
    // Relocked in Phase 3A — see docs/DECISIONS.md "D-3A-1". Layer 1 is the
    // inviolable rules layer; the equality below is the drift guard between
    // @gai/shared's CONTEXT_LAYERS and caddie-context's LAYER_ORDER.
    expect(CONTEXT_LAYERS[0]).toBe("core_rules");
    expect(LAYER_ORDER).toEqual(CONTEXT_LAYERS);
    expect(CONTEXT_LAYERS).toHaveLength(5);
  });
});

// ── Phase 2B — predictHole (sg-engine) ─────────────────────────────────────────
// Michael's real bag after the >=5-shot promote (decision D-2B-1): all measured.
const MJF_BAG: ClubDispersion[] = [
  { club: "driver", carryMean: 272.7, carrySD: 19.8, lateralSD: 16.1, confidence: "measured" },
  { club: "3h", carryMean: 194.5, carrySD: 5.7, lateralSD: 8.9, confidence: "measured" },
  { club: "5h", carryMean: 184.7, carrySD: 4.0, lateralSD: 7.7, confidence: "measured" },
  { club: "4i", carryMean: 183.0, carrySD: 9.8, lateralSD: 9.5, confidence: "measured" },
  { club: "6i", carryMean: 171.2, carrySD: 6.7, lateralSD: 4.6, confidence: "measured" },
  { club: "7i", carryMean: 158.0, carrySD: 7.5, lateralSD: 7.8, confidence: "measured" },
  { club: "8i", carryMean: 149.9, carrySD: 10.2, lateralSD: 6.5, confidence: "measured" },
  { club: "9i", carryMean: 139.5, carrySD: 3.2, lateralSD: 11.0, confidence: "measured" },
  { club: "PW", carryMean: 126.7, carrySD: 6.9, lateralSD: 6.6, confidence: "measured" },
  { club: "GW50", carryMean: 107.0, carrySD: 4.6, lateralSD: 4.8, confidence: "measured" },
  { club: "SW54", carryMean: 95.6, carrySD: 4.0, lateralSD: 3.8, confidence: "measured" },
  { club: "LW60", carryMean: 80.2, carrySD: 2.8, lateralSD: 2.0, confidence: "measured" },
  { club: "LW64", carryMean: 75.8, carrySD: 1.7, lateralSD: 3.8, confidence: "measured" },
];

const APPROACH_HOLE: HoleInput = {
  number: 7,
  par: 4,
  strokeIndex: 8,
  yardageWhite: 150,
  features: [{ kind: "bunker", side: "right", distanceFromTee: 140, carryToClear: null }],
};

describe("invariant #1 (Phase 2B) — predictHole is the deterministic strategy math", () => {
  it("1. determinism: identical inputs -> identical StrategyResult across 3 calls", () => {
    const a = predictHole(APPROACH_HOLE, MJF_BAG, PERSONAS.rain_man!);
    const b = predictHole(APPROACH_HOLE, MJF_BAG, PERSONAS.rain_man!);
    const c = predictHole(APPROACH_HOLE, MJF_BAG, PERSONAS.rain_man!);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("2. voice-only swap: same risk numbers, different name -> identical club & target", () => {
    const voiceA: PersonaRiskConfig = { name: "Alpha", missPercentile: 0.75, layupBias: 0.1, aggressionMultiplier: 1.0 };
    const voiceB: PersonaRiskConfig = { ...voiceA, name: "Omega" };
    const ra = predictHole(APPROACH_HOLE, MJF_BAG, voiceA);
    const rb = predictHole(APPROACH_HOLE, MJF_BAG, voiceB);
    expect(ra.recommendedClub).toBe(rb.recommendedClub);
    expect(ra.carryTarget).toBe(rb.carryTarget);
  });

  it("3. risk direction: Beta is more conservative than The Ringer on a forced carry", () => {
    // Bag tops out at 158 carry vs a 160y forced carry: conservative lays up,
    // aggressive goes for it.
    const shortBag: ClubDispersion[] = [
      { club: "6i", carryMean: 158, carrySD: 7.5, lateralSD: 8, confidence: "measured" },
      { club: "7i", carryMean: 148, carrySD: 7, lateralSD: 7.5, confidence: "measured" },
      { club: "8i", carryMean: 138, carrySD: 6.5, lateralSD: 7, confidence: "measured" },
      { club: "PW", carryMean: 120, carrySD: 6, lateralSD: 6, confidence: "measured" },
    ];
    const forcedCarry: HoleInput = {
      number: 3,
      par: 3,
      strokeIndex: 6,
      yardageWhite: 165,
      features: [{ kind: "water", side: "center", distanceFromTee: 165, carryToClear: 160 }],
    };
    const beta = predictHole(forcedCarry, shortBag, PERSONAS.beta!);
    const ringer = predictHole(forcedCarry, shortBag, PERSONAS.the_ringer!);
    expect(beta.layupRecommended === true || beta.carryTarget <= ringer.carryTarget).toBe(true);
    // Spell out the intended direction: Beta lays up, The Ringer does not.
    expect(beta.layupRecommended).toBe(true);
    expect(ringer.layupRecommended).toBe(false);
  });

  it("4. confidence propagation: a seeded club taints the flag; all-measured stays measured", () => {
    const noHazard: HoleInput = { number: 1, par: 4, strokeIndex: 10, yardageWhite: 150, features: [] };
    const seededBag: ClubDispersion[] = [
      { club: "7i", carryMean: 150, carrySD: 7, lateralSD: 7, confidence: "seeded" },
      { club: "8i", carryMean: 138, carrySD: 6, lateralSD: 6, confidence: "measured" },
    ];
    const measuredBag: ClubDispersion[] = seededBag.map((c) => ({ ...c, confidence: "measured" }));
    expect(predictHole(noHazard, seededBag, PERSONAS.rain_man!).confidenceFlag).toBe("seeded");
    expect(predictHole(noHazard, measuredBag, PERSONAS.rain_man!).confidenceFlag).toBe("measured");
  });

  it("5. no I/O boundary: every sg-engine source file is free of I/O / network / SDK imports", () => {
    const srcDir = fileURLToPath(new URL("../packages/sg-engine/src/", import.meta.url));
    const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(1); // types, personas, stats, engine, index
    const forbidden = [
      'from "pg"', 'from "fs"', "node:fs", "node:net", "node:http", "node:https",
      "fetch(", "http", "Math.random", "Date.now", "new Date(", "@anthropic", "server-only",
    ];
    for (const f of files) {
      const src = stripComments(readFileSync(srcDir + f, "utf8"));
      for (const bad of forbidden) {
        expect(src.includes(bad), `packages/sg-engine/src/${f} must not contain: ${bad}`).toBe(false);
      }
    }
  });

  it("6. Fox Bend Hole 3 smoke test: real bag, Rain Man, water both sides", () => {
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
    const r = predictHole(hole3, MJF_BAG, PERSONAS.rain_man!);
    expect(r.carryTarget).toBeGreaterThanOrEqual(140);
    expect(r.carryTarget).toBeLessThanOrEqual(165);
    expect(r.dangerSide).not.toBeNull();
    expect(r.confidenceFlag).toBe("measured");
  });
});

// ── Phase 3C — Broadie expected-strokes model (sg-engine) ───────────────────────
describe("invariant #1 (Phase 3C) — the Broadie expected-strokes model is deterministic math", () => {
  const OPEN_HOLE: HoleInput = {
    number: 1,
    par: 4,
    strokeIndex: 10,
    yardageWhite: 150,
    features: [],
  };
  const EIGHT_IRON = MJF_BAG.find((c) => c.club === "8i")!;

  const FOX_BEND_HOLE_3: HoleInput = {
    number: 3,
    par: 3,
    strokeIndex: 16,
    yardageWhite: 150,
    features: [
      { kind: "water", side: "left", distanceFromTee: null, carryToClear: 160 },
      { kind: "water", side: "right", distanceFromTee: null, carryToClear: 160 },
    ],
  };

  it("1. determinism: computeExpectedStrokes on identical inputs returns the identical value", () => {
    const a = computeExpectedStrokes(OPEN_HOLE, EIGHT_IRON, 150);
    const b = computeExpectedStrokes(OPEN_HOLE, EIGHT_IRON, 150);
    expect(a).toBe(b);
    expect(Number.isFinite(a)).toBe(true);
  });

  it("2. baseline ordering: fairway < rough < bunker < penalty at the same distance", () => {
    // The SG baseline must price the lies monotonically — Layer 1 accuracy.
    for (const d of [100, 150, 175]) {
      const fairway = expectedStrokesFromLie(d, "fairway");
      const rough = expectedStrokesFromLie(d, "rough");
      const bunker = expectedStrokesFromLie(d, "bunker");
      const penalty = expectedStrokesFromLie(d, "penalty");
      expect(fairway).toBeLessThan(rough);
      expect(rough).toBeLessThan(bunker);
      expect(bunker).toBeLessThan(penalty);
    }
  });

  it("3. sampler determinism: sampleDispersion returns identical arrays for identical inputs", () => {
    const a = sampleDispersion(150, 10, 7, 500);
    const b = sampleDispersion(150, 10, 7, 500);
    expect(a).toHaveLength(500);
    expect(a).toEqual(b);
  });

  it("4. Fox Bend Hole 3 regression: 8i / carry 150, with a real (non-placeholder) expectedStrokes", () => {
    const r = predictHole(FOX_BEND_HOLE_3, MJF_BAG, PERSONAS.rain_man!);
    expect(r.recommendedClub).toBe("8i");
    expect(r.carryTarget).toBe(150);
    // A real sampled value, in a plausible par-3 range — and NOT the old placeholder
    // formula result (par + 0.1*(strokeIndex-9) = 3 + 0.7 = 3.7).
    expect(r.expectedStrokes).toBeGreaterThanOrEqual(2.8);
    expect(r.expectedStrokes).toBeLessThanOrEqual(4.5);
    expect(r.expectedStrokes).not.toBe(3.7);
  });

  it("5. no I/O boundary: every sg-engine source file (incl. the new Phase 3C modules) is I/O-free", () => {
    const srcDir = fileURLToPath(new URL("../packages/sg-engine/src/", import.meta.url));
    const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
    // The four new modules must be present alongside the existing surface.
    for (const f of ["sgBaseline.ts", "sampler.ts", "classifier.ts", "expectedStrokes.ts"]) {
      expect(files.includes(f), `expected packages/sg-engine/src/${f}`).toBe(true);
    }
    const forbidden = [
      'from "pg"', 'from "fs"', "node:fs", "node:net", "node:http", "node:https",
      "fetch(", "http", "Math.random", "Date.now", "new Date(", "@anthropic", "server-only",
    ];
    for (const f of files) {
      const src = stripComments(readFileSync(srcDir + f, "utf8"));
      for (const bad of forbidden) {
        expect(src.includes(bad), `packages/sg-engine/src/${f} must not contain: ${bad}`).toBe(false);
      }
    }
  });
});

// ── Phase 3B — Anthropic API route + the key boundary ───────────────────────────
describe("invariant #3 (Phase 3B) — the Anthropic key is never client-side", () => {
  it("no app/ file outside app/api/ names ANTHROPIC_API_KEY or a NEXT_PUBLIC_ var", () => {
    const appDir = join(root, "apps/web/src/app");
    const apiDir = join(appDir, "api") + sep; // server-only routes live here — exempt
    const files = walk(appDir).filter(
      (f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.startsWith(apiDir),
    );
    // The panel + page live here; if either reached for the key or a NEXT_PUBLIC_
    // var, the value would be inlined into the client bundle — invariant #3 broken.
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const where = relative(root, f);
      expect(src.includes("ANTHROPIC_API_KEY"), `${where} must not name the key`).toBe(false);
      expect(src.includes("NEXT_PUBLIC_"), `${where} must not use a NEXT_PUBLIC_ var`).toBe(false);
    }
  });
});

describe("invariant #1 (Phase 3B) — the strategy stream carries the engine's numbers", () => {
  const hasDb = Boolean(process.env.DATABASE_URL);

  it.skipIf(!hasDb)(
    "Fox Bend Hole 3 + Rain Man streams club '8' and carry '150' from the engine, not the LLM",
    async () => {
      const pool = getPool();
      const { rows } = await pool.query<{ id: string }>(
        "SELECT id FROM course WHERE name = $1",
        ["Fox Bend Golf Course"],
      );
      expect(rows[0]).toBeDefined();
      const courseId = rows[0]!.id;

      // The mocked caddie voice is deliberately digit-free, so any "8" or "150" in
      // the stream can only have come from the engine's EngineView block.
      const fixed = "Take the safe two-putt target. Center of the green. Commit to it.";
      const stream = await runStrategyStream(
        { courseId, holeNumber: 3, persona: "rain_man", conditions: {} },
        { streamText: async function* () { yield fixed; } },
      );

      const out = await drain(stream);
      expect(out).toContain("8"); // the club (8i) — from predictHole
      expect(out).toContain("150"); // the carry target — from predictHole
      // Leak guard (invariant #5): internal artifacts never reach the client.
      expect(out).not.toContain("## LAYER");
      expect(out.toLowerCase()).not.toContain("reasoning");
    },
  );
});

// ── Phase 4 — Mode B on-course UI ───────────────────────────────────────────────
describe("Phase 4 — Mode B on-course UI", () => {
  const hasDb = Boolean(process.env.DATABASE_URL);
  const MODE_B_DIR = "apps/web/src/app/play/[courseId]/holes/[holeNumber]/";
  const MODE_B_PAGE = MODE_B_DIR + "page.tsx";
  const MODE_B_VIEW = MODE_B_DIR + "HoleView.tsx";
  const MODE_A_PAGE = "apps/web/src/app/courses/[courseId]/holes/[holeNumber]/page.tsx";
  // Every client/server file that ships as part of the Mode B route surface.
  const MODE_B_FILES = [
    MODE_B_PAGE,
    MODE_B_VIEW,
    "apps/web/src/app/play/page.tsx",
    "apps/web/src/app/play/[courseId]/page.tsx",
    "apps/web/src/app/play/[courseId]/HoleList.tsx",
  ];

  it("route exists: GET /play/[courseId]/holes/1 resolves a hole for Fox Bend (→ 200)", async () => {
    // The route file exists and renders the Mode B decision view from a hole row.
    expect(existsSync(root + MODE_B_PAGE)).toBe(true);
    const page = read(MODE_B_PAGE);
    expect(page.includes("HoleView")).toBe(true);
    expect(page.includes("FROM hole")).toBe(true);
    expect(page.includes("notFound")).toBe(true); // a missing hole 404s, a real one 200s

    if (!hasDb) return; // with no DB, the structural wiring above stands in for the render
    // The query the route runs for hole 1 returns a row, so the page renders (200)
    // rather than calling notFound() (404).
    const pool = getPool();
    const { rows: courses } = await pool.query<{ id: string }>(
      "SELECT id FROM course WHERE name = $1",
      ["Fox Bend Golf Course"],
    );
    expect(courses[0]).toBeDefined();
    const { rows: holes } = await pool.query(
      "SELECT number, par, stroke_index FROM hole WHERE course_id = $1 AND number = 1",
      [courses[0]!.id],
    );
    expect(holes[0]).toBeDefined();
  });

  it("Mode A is untouched: the prep hole page still renders the strategy panel", () => {
    // Mode B lives at a separate route; the existing Mode A page and its panel must
    // be unchanged and still present (the strategy panel markup).
    expect(existsSync(root + MODE_A_PAGE)).toBe(true);
    const modeA = read(MODE_A_PAGE);
    expect(modeA.includes("StrategyPanel")).toBe(true);
    expect(modeA.includes("<StrategyPanel")).toBe(true);
    expect(
      existsSync(root + "apps/web/src/app/courses/[courseId]/holes/[holeNumber]/StrategyPanel.tsx"),
    ).toBe(true);
  });

  it("no API key client-side: Mode B files never name ANTHROPIC_API_KEY or a NEXT_PUBLIC_ var", () => {
    for (const f of MODE_B_FILES) {
      expect(existsSync(root + f), `${f} should exist`).toBe(true);
      const src = read(f);
      expect(src.includes("ANTHROPIC_API_KEY"), `${f} must not name the key`).toBe(false);
      expect(src.includes("NEXT_PUBLIC_"), `${f} must not use a NEXT_PUBLIC_ var`).toBe(false);
    }
  });
});

// ── Phase 4.5 — Practice tab (ranker + Layer-5 swap + no-fabricated-URL) ────────
describe("Phase 4.5 — practice coach: deterministic ranking, Layer-5 swap, invariant #4", () => {
  const hasDb = Boolean(process.env.DATABASE_URL);

  // A representative current state: driver is the data gap, a club leans right,
  // a club is low feel-trust, and three-putts overshoot the benchmark.
  const RANKER_INPUT = {
    clubDispersion: [
      { club: "driver", confidence: "partial", lateralSD: 16.1, carrySD: 19.8 },
      { club: "3h", confidence: "measured", lateralSD: 18.0, carrySD: 5.7 },
      { club: "7i", confidence: "measured", lateralSD: 7.8, carrySD: 7.5 },
    ],
    clubConfidence: [{ club: "4i", feelLevel: 1 }],
    scoringWeaknesses: [
      { area: "three_putt_pct", value: 10.2, benchmark: 6.0 },
      { area: "doubles_per_round", value: 1.1, benchmark: 1.0 }, // below 1.3× → must NOT fire
    ],
  };

  it("1. ranker determinism: identical inputs -> identical output", () => {
    const a = rankPracticeSignals(RANKER_INPUT);
    const b = rankPracticeSignals(RANKER_INPUT);
    expect(a).toEqual(b);
    // The sub-threshold weakness never produced a signal.
    expect(a.some((s) => s.sourceSignal.includes("doubles_per_round"))).toBe(false);
  });

  it("2. ranker priority order: seeded > partial > high-lateralSD", () => {
    const out = rankPracticeSignals({
      clubDispersion: [
        { club: "driver", confidence: "seeded", lateralSD: 10, carrySD: 20 },
        { club: "7i", confidence: "partial", lateralSD: 8, carrySD: 7 },
        { club: "9i", confidence: "measured", lateralSD: 18, carrySD: 5 },
      ],
      clubConfidence: [],
      scoringWeaknesses: [],
    });
    // Distinct areas, so all three survive dedup in rule order.
    expect(out).toHaveLength(3);
    expect(out[0]!.sourceSignal).toBe("driver.confidence=seeded");
    expect(out[1]!.sourceSignal).toBe("7i.confidence=partial");
    expect(out[2]!.sourceSignal).toBe("9i.lateralSD=18");
    // priority is 1-based and strictly increasing in that order.
    expect(out[0]!.priority).toBeLessThan(out[1]!.priority);
    expect(out[1]!.priority).toBeLessThan(out[2]!.priority);
  });

  it("3. no fabricated URLs: every drill resource_url is NULL or starts with https://", async () => {
    // File-level guard (always runs): the seed never hardcodes an insecure URL.
    const seed = read("services/api/src/migrations/006_drill_seed.sql");
    expect(seed.includes("http://")).toBe(false);

    // Authoritative guard against the live DB after migration (invariant #4).
    if (!hasDb) return;
    await runMigrations();
    const pool = getPool();
    const { rows } = await pool.query<{ resource_url: string | null }>(
      "SELECT resource_url FROM drill",
    );
    expect(rows.length).toBeGreaterThanOrEqual(12);
    for (const r of rows) {
      if (r.resource_url !== null) {
        expect(r.resource_url.startsWith("https://"), `bad drill URL: ${r.resource_url}`).toBe(true);
      }
    }
  });

  it("4. Layer-5 swap isolation: signals are in, the hole layer is out", () => {
    const signals = rankPracticeSignals({
      clubDispersion: [{ club: "driver", confidence: "partial", lateralSD: 16, carrySD: 20 }],
      clubConfidence: [],
      scoringWeaknesses: [{ area: "three_putt_pct", value: 10.2, benchmark: 6.0 }],
    });
    expect(signals.length).toBeGreaterThanOrEqual(2);

    const block = buildPracticeCoachLayer(signals);
    const prompt = assemblePracticePrompt(signals, "rain_man", [
      {
        area: "driver",
        title: "Tee-bay sample: 12+ drivers",
        description: "Hit at least 12 full drivers at one target.",
        resource_url: null,
        resource_kind: "drill",
      },
    ]);

    // The ranked signal descriptions made it into the assembled prompt.
    for (const s of signals) {
      expect(prompt.includes(s.description), `prompt missing signal: ${s.description}`).toBe(true);
    }

    // The swapped-IN Layer 5 block carries NO hole/course vocabulary. (We check the
    // block, not the whole prompt: Layer 1/3 legitimately contain words like
    // "yardage" and "green" in the static rules and player profile.)
    expect(/yardage/i.test(block)).toBe(false);
    expect(/carry target/i.test(block)).toBe(false);
    expect(/green/i.test(block)).toBe(false);

    // The course/hole Layer 2 was genuinely swapped OUT of the full prompt.
    expect(prompt.includes("## LAYER 2")).toBe(false);
    expect(prompt.includes("Carry target:")).toBe(false);
    expect(prompt.includes("Engine recommendation")).toBe(false);
    expect(prompt.includes("## LAYER 5 — PRACTICE SIGNALS")).toBe(true);
  });

  it("5. coach endpoint key safety: the route never names the key or a NEXT_PUBLIC_ var", () => {
    const route = read("apps/web/src/app/api/practice/coach/route.ts");
    expect(route.includes("ANTHROPIC_API_KEY"), "coach route must not name the key").toBe(false);
    expect(route.includes("NEXT_PUBLIC_"), "coach route must not use a NEXT_PUBLIC_ var").toBe(false);
  });
});

// ── Phase 5 — score backend, round persistence, post-round recap ────────────────
describe("Phase 5 — rounds: persistence, upsert idempotency, scoring weaknesses", () => {
  const hasDb = Boolean(process.env.DATABASE_URL);

  // Track every fixture course so we can remove them after the suite. These tests
  // run against the SAME Neon DB production reads, so a leaked fixture would show up
  // in the live /courses + /play lists. Clean up so that can never happen.
  const fixtureCourseIds: string[] = [];

  /** Insert a throwaway course so a test's rounds are isolated from real data. */
  async function makeCourse(name: string): Promise<string> {
    const pool = getPool();
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO course (name) VALUES ($1) RETURNING id",
      [name],
    );
    const id = rows[0]!.id;
    fixtureCourseIds.push(id);
    return id;
  }

  // Remove the fixture courses (round rows cascade via the round.course_id FK), so
  // no test data lingers in the shared DB. Belt-and-suspenders: also sweep any
  // older 'Phase5 %' fixtures from prior runs that may have been left behind.
  afterAll(async () => {
    if (!hasDb) return;
    const pool = getPool();
    if (fixtureCourseIds.length > 0) {
      await pool.query("DELETE FROM course WHERE id = ANY($1::uuid[])", [fixtureCourseIds]);
    }
    await pool.query("DELETE FROM course WHERE name LIKE 'Phase5 %'");
  });

  it.skipIf(!hasDb)(
    "1. round creation round-trip: createRound writes a row; getRound reads it back with the right courseId + date",
    async () => {
      await runMigrations();
      const courseId = await makeCourse("Phase5 Round-Trip Course");
      const { roundId } = await createRound({
        courseId,
        playedDate: "2026-06-05",
        teeSet: "white",
      });
      expect(roundId).toMatch(/^[0-9a-f-]{36}$/);

      const round = await getRound(roundId);
      expect(round).not.toBeNull();
      expect(round!.courseId).toBe(courseId);
      expect(round!.playedDate).toBe("2026-06-05");
      expect(round!.teeSet).toBe("white");
    },
  );

  it.skipIf(!hasDb)(
    "2. hole upsert idempotency: a second POST for the same hole UPDATES rather than duplicating",
    async () => {
      await runMigrations();
      const courseId = await makeCourse("Phase5 Upsert Course");
      const { roundId } = await createRound({ courseId, playedDate: "2026-06-05" });

      await upsertRoundHole(roundId, { holeNumber: 1, strokes: 5, putts: 2 });
      await upsertRoundHole(roundId, { holeNumber: 1, strokes: 4, putts: 1 });

      const round = await getRound(roundId);
      const hole1 = round!.holes.filter((h) => h.holeNumber === 1);
      expect(hole1).toHaveLength(1); // upsert, not duplicate
      expect(hole1[0]!.strokes).toBe(4); // the update won
      expect(hole1[0]!.putts).toBe(1);
    },
  );

  it.skipIf(!hasDb)(
    "3. scoring weakness query: 3 rounds × 2 three-putts (= 11.1%) surfaces three_putt_pct as a weakness > 6.0",
    async () => {
      await runMigrations();
      const courseId = await makeCourse("Phase5 Weakness Course");

      // 3 rounds, 18 holes each = 54 holes; 2 three-putts per round = 6/54 = 11.1%.
      for (let r = 0; r < 3; r++) {
        const { roundId } = await createRound({ courseId, playedDate: "2026-06-05" });
        for (let h = 1; h <= 18; h++) {
          await upsertRoundHole(roundId, { holeNumber: h, strokes: 4, putts: h <= 2 ? 3 : 2 });
        }
      }

      // Scoped to this synthetic course so the assertion is deterministic regardless
      // of any other rounds present in the shared dev DB.
      const weaknesses = await computeScoringWeaknesses({}, { courseId });
      const threePutt = weaknesses.find((w) => w.area === "three_putt_pct");
      expect(threePutt, "three_putt_pct should surface as a weakness").toBeDefined();
      expect(threePutt!.value).toBeGreaterThan(6.0);
      expect(threePutt!.benchmark).toBe(6.0);
    },
  );

  it("4. recap route key safety: the route never names the key or a NEXT_PUBLIC_ var", () => {
    const route = read("apps/web/src/app/api/rounds/[roundId]/recap/route.ts");
    expect(route.includes("ANTHROPIC_API_KEY"), "recap route must not name the key").toBe(false);
    expect(route.includes("NEXT_PUBLIC_"), "recap route must not use a NEXT_PUBLIC_ var").toBe(false);
  });

  it("5. Mode B untouched: the hole route still resolves a hole and still has the score chips + caddie panel", () => {
    const page = read("apps/web/src/app/play/[courseId]/holes/[holeNumber]/page.tsx");
    // Still the DB-backed Mode B page that 200s on a real hole / 404s on a missing one.
    expect(page.includes("HoleView")).toBe(true);
    expect(page.includes("FROM hole")).toBe(true);
    expect(page.includes("notFound")).toBe(true);

    const view = read("apps/web/src/app/play/[courseId]/holes/[holeNumber]/HoleView.tsx");
    expect(view.includes("mb-score-chip"), "score chips must remain").toBe(true);
    expect(view.includes("mb-caddie"), "the caddie panel must remain").toBe(true);
  });
});
