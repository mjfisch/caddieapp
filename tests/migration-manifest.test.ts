import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MIGRATIONS } from "../services/api/src/migrations.generated";
// @ts-expect-error — plain .mjs script, no type declarations; vitest loads it fine.
import { generateManifestSource, MIGRATIONS_DIR, MANIFEST_PATH } from "../services/api/scripts/generate-migrations-manifest.mjs";

// Mission 2.6: the migration runner discovers migrations via the build-time
// manifest (migrations.generated.ts), never the filesystem. These tests pin the
// manifest to the source-of-truth directory — no DATABASE_URL needed.

const sqlFiles = readdirSync(MIGRATIONS_DIR as string)
  .filter((f: string) => f.endsWith(".sql"))
  .sort();

describe("migrations manifest (build-time generated)", () => {
  it("contains every .sql file in services/api/src/migrations, in filename order", () => {
    expect(MIGRATIONS.map((m) => m.filename)).toEqual(sqlFiles);
  });

  it("embeds each migration's exact SQL content", () => {
    for (const { filename, sql } of MIGRATIONS) {
      const onDisk = readFileSync(join(MIGRATIONS_DIR as string, filename), "utf8");
      expect(sql, `${filename} content should match the .sql file`).toBe(onDisk);
    }
  });

  it("checked-in manifest is byte-identical to a fresh generation (not stale)", () => {
    // The prebuild step regenerates this on every deploy, so a stale checked-in
    // copy can't reach production — but dev/tests use the checked-in file, so
    // fail here if someone adds a migration without regenerating.
    const fresh = generateManifestSource() as string;
    const checkedIn = readFileSync(MANIFEST_PATH as string, "utf8");
    expect(checkedIn).toBe(fresh);
  });

  it("is never empty (the runner throws on an empty manifest)", () => {
    expect(MIGRATIONS.length).toBeGreaterThan(0);
  });

  it("includes the 010 smoke migration for the end-to-end deploy proof", () => {
    expect(MIGRATIONS.some((m) => m.filename === "010_runner_smoke.sql")).toBe(true);
  });
});
