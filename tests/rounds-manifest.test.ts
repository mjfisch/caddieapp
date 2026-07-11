import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROUND_FILES } from "../services/api/src/rounds.generated";
// @ts-expect-error — plain .mjs script, no type declarations; vitest loads it fine.
import { generateRoundsManifestSource, ROUNDS_DIR, ROUNDS_MANIFEST_PATH } from "../services/api/scripts/generate-rounds-manifest.mjs";

// Mission S4 / D22: the round sync discovers payloads via the build-time
// manifest (rounds.generated.ts), never the filesystem — the exact mirror of
// tests/migration-manifest.test.ts. These pin the manifest to the
// source-of-truth data/rounds/ directory — no DATABASE_URL needed.

const jsonFiles = readdirSync(ROUNDS_DIR as string)
  .filter((f: string) => f.endsWith(".json"))
  .sort();

describe("rounds manifest (build-time generated)", () => {
  it("contains every .json file in data/rounds, in filename order", () => {
    expect(ROUND_FILES.map((r) => r.filename)).toEqual(jsonFiles);
  });

  it("embeds each round's exact JSON content", () => {
    for (const { filename, json } of ROUND_FILES) {
      const onDisk = readFileSync(join(ROUNDS_DIR as string, filename), "utf8");
      expect(json, `${filename} content should match the .json file`).toBe(onDisk);
    }
  });

  it("checked-in manifest is byte-identical to a fresh generation (not stale)", () => {
    // The prebuild step regenerates this on every deploy, so a stale checked-in
    // copy can't reach production — but dev/tests use the checked-in file, so
    // fail here if someone adds a round without regenerating.
    const fresh = generateRoundsManifestSource() as string;
    const checkedIn = readFileSync(ROUNDS_MANIFEST_PATH as string, "utf8");
    expect(checkedIn).toBe(fresh);
  });

  it("is never empty (the sync throws on an empty manifest)", () => {
    expect(ROUND_FILES.length).toBeGreaterThan(0);
  });

  it("every entry parses as JSON (malformed payloads throw at build, never silently skip)", () => {
    for (const { filename, json } of ROUND_FILES) {
      expect(() => JSON.parse(json), `${filename} should be valid JSON`).not.toThrow();
    }
  });

  it("includes the June 22 Fox Bend smoke round for the end-to-end sync proof", () => {
    expect(ROUND_FILES.some((r) => r.filename === "2026-06-22_fox-bend.json")).toBe(true);
  });
});
