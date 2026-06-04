import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CONFIDENCE_COLOR, CONTEXT_LAYERS } from "@gai/shared";
import { deterministicProbe } from "@gai/sg-engine";
import { LAYER_ORDER } from "@gai/caddie-context";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p: string) => readFileSync(root + p, "utf8");

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
  it("the locked layer order starts with accuracy", () => {
    expect(CONTEXT_LAYERS[0]).toBe("accuracy");
    expect(LAYER_ORDER).toEqual(CONTEXT_LAYERS);
    expect(CONTEXT_LAYERS).toHaveLength(5);
  });
});
