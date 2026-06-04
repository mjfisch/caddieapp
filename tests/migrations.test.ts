import { describe, it, expect } from "vitest";
import { runMigrations, getPool } from "@gai/api";

// Phase 1: runMigrations() applies 001 (schema) + 002 (Fox Bend seed) against
// the real DB (Neon in dev/prod). Requires DATABASE_URL — skip loudly if unset,
// same as the round-trip gate. Migrations are idempotent, so re-running across
// test runs is a no-op and the assertions below stay stable.
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("runMigrations: schema + Fox Bend seed", () => {
  it("creates course / hole / hole_feature and seeds one Fox Bend course", async () => {
    await runMigrations();
    const pool = getPool();

    // Tables exist (to_regclass is null for a missing relation).
    for (const table of ["course", "hole", "hole_feature"]) {
      const { rows } = await pool.query<{ reg: string | null }>(
        "SELECT to_regclass($1) AS reg",
        [table]
      );
      expect(rows[0]?.reg, `table ${table} should exist`).toBe(table);
    }

    // Exactly one Fox Bend course row.
    const { rows } = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM course WHERE name = $1",
      ["Fox Bend Golf Course"]
    );
    expect(rows[0]?.count).toBe(1);
  });
});

describe.skipIf(hasDb)("runMigrations (skipped — no DATABASE_URL)", () => {
  it("is skipped without DATABASE_URL", () => {
    expect(hasDb).toBe(false);
  });
});
