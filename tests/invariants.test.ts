import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIDENCE_COLOR, CONTEXT_LAYERS } from "@gai/shared";
import {
  deterministicProbe,
  predictHole,
  PERSONAS,
  type ClubDispersion,
  type HoleInput,
  type PersonaRiskConfig,
} from "@gai/sg-engine";
import { LAYER_ORDER } from "@gai/caddie-context";
import { getPool, runStrategyStream } from "@gai/api";

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
