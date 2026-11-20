import { describe, it, expect, afterAll } from "vitest";
import {
  runMigrations,
  syncRounds,
  getPool,
  createRound,
  upsertRoundHole,
  markRoundTest,
  computeTotalStrokes,
} from "@gai/api";
import { MIGRATIONS } from "../services/api/src/migrations.generated";

// =============================================================
// round.total_strokes: set on save when the card is complete (18 holes, all
// with strokes), recomputed / cleared as holes change, and backfilled by 015.
//
// Two tiers (the stats-schema.test.ts pattern): the pure rule runs without
// credentials; the writer + backfill proofs gate on DATABASE_URL and
// self-clean. ASCII only (see the esbuild note in practice-stats-compute.test.ts).
// =============================================================

const hasDb = Boolean(process.env.DATABASE_URL);

const card = (strokes: (number | null)[]) =>
  strokes.map((s, i) => ({ holeNumber: i + 1, strokes: s }));
const FULL = card(Array.from({ length: 18 }, (_, i) => (i % 3 === 0 ? 5 : 4))); // 6x5 + 12x4 = 78

// ---- Tier 1: the pure rule --------------------------------------------------

describe("computeTotalStrokes (no DB needed)", () => {
  it("sums a complete 18-hole card", () => {
    expect(computeTotalStrokes(FULL)).toBe(78);
  });

  it("is order-independent", () => {
    expect(computeTotalStrokes([...FULL].reverse())).toBe(78);
  });

  it("is null for a partial card (never a 9-hole sum posing as a gross)", () => {
    expect(computeTotalStrokes(FULL.slice(0, 9))).toBeNull();
    expect(computeTotalStrokes(FULL.slice(0, 17))).toBeNull();
    expect(computeTotalStrokes([])).toBeNull();
  });

  it("is null when any hole lacks strokes", () => {
    const holes = card([...Array(17).fill(4), null]);
    expect(computeTotalStrokes(holes)).toBeNull();
    const undef = FULL.map((h, i) => (i === 3 ? { ...h, strokes: undefined } : h));
    expect(computeTotalStrokes(undef)).toBeNull();
  });

  it("is null for 18 rows that do not cover holes 1-18 exactly once", () => {
    const dup = FULL.map((h, i) => (i === 17 ? { ...h, holeNumber: 1 } : h));
    expect(computeTotalStrokes(dup)).toBeNull();
    const outOfRange = FULL.map((h, i) => (i === 17 ? { ...h, holeNumber: 19 } : h));
    expect(computeTotalStrokes(outOfRange)).toBeNull();
  });

  it("the 015 backfill mirrors the same rule (18 rows, non-null strokes, holes 1-18, only NULL totals)", () => {
    const sql = MIGRATIONS.find((m) => m.filename === "015_round_total_strokes_backfill.sql")?.sql;
    expect(sql, "015 must be in the manifest").toBeDefined();
    expect(sql).toContain("COUNT(*) = 18");
    expect(sql).toContain("COUNT(rh.strokes) = 18");
    expect(sql).toContain("BETWEEN 1 AND 18");
    expect(sql).toContain("r.total_strokes IS NULL");
    // The runner owns the transaction; check the statements, not the header prose.
    const statements = sql!.replace(/--.*$/gm, "");
    expect(statements).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/);
  });
});

// ---- Tier 2: DB-gated writer + backfill proofs ------------------------------

describe.skipIf(!hasDb)("round.total_strokes against the live schema", () => {
  const fixtureCourseIds: string[] = [];

  async function makeRound(key: string): Promise<string> {
    const pool = getPool();
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO course (name) VALUES ($1) RETURNING id",
      [`TotalStrokes ${key}`],
    );
    fixtureCourseIds.push(rows[0]!.id);
    const { roundId } = await createRound({
      courseId: rows[0]!.id,
      playedDate: "2026-07-01",
      differential: 0,
      differentialSource: "computed_adjusted",
      externalKey: `2026-07-01_total-strokes-${key}`,
    });
    // Keep the fixture out of the live handicap / weakness signal.
    await markRoundTest(roundId, true);
    return roundId;
  }

  async function totalOf(roundId: string): Promise<number | null> {
    const { rows } = await getPool().query<{ total_strokes: number | null }>(
      "SELECT total_strokes FROM round WHERE id = $1",
      [roundId],
    );
    return rows[0]!.total_strokes;
  }

  afterAll(async () => {
    const pool = getPool();
    if (fixtureCourseIds.length > 0) {
      await pool.query("DELETE FROM round WHERE course_id = ANY($1::uuid[])", [fixtureCourseIds]);
      await pool.query("DELETE FROM course WHERE id = ANY($1::uuid[])", [fixtureCourseIds]);
    }
    await pool.query("DELETE FROM course WHERE name LIKE 'TotalStrokes %'");
  });

  it("1. upsertRoundHole: NULL until 18 holes, set at 18, recomputed on a re-tap", async () => {
    await runMigrations();
    const roundId = await makeRound("upsert");
    for (const h of FULL.slice(0, 17)) {
      await upsertRoundHole(roundId, { holeNumber: h.holeNumber, strokes: h.strokes as number });
    }
    expect(await totalOf(roundId), "17 holes is not a gross").toBeNull();

    await upsertRoundHole(roundId, { holeNumber: 18, strokes: FULL[17]!.strokes as number });
    expect(await totalOf(roundId)).toBe(78);

    await upsertRoundHole(roundId, { holeNumber: 1, strokes: 3 }); // was 5
    expect(await totalOf(roundId)).toBe(76);
  });

  it("2. a hole deleted under a complete card clears the total on the next save", async () => {
    await runMigrations();
    const roundId = await makeRound("clear");
    for (const h of FULL) {
      await upsertRoundHole(roundId, { holeNumber: h.holeNumber, strokes: h.strokes as number });
    }
    expect(await totalOf(roundId)).toBe(78);
    await getPool().query("DELETE FROM round_hole WHERE round_id = $1 AND hole_number = 18", [roundId]);
    await upsertRoundHole(roundId, { holeNumber: 1, strokes: 5 });
    expect(await totalOf(roundId)).toBeNull();
  });

  it("3. an unknown roundId is a 400 and writes nothing", async () => {
    await runMigrations();
    await expect(
      upsertRoundHole("00000000-0000-0000-0000-000000000000", { holeNumber: 1, strokes: 4 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("4. the 015 backfill fills a complete NULL card, skips a partial one, and is idempotent", async () => {
    await runMigrations();
    const pool = getPool();
    const complete = await makeRound("backfill-complete");
    const partial = await makeRound("backfill-partial");
    const preset = await makeRound("backfill-preset");
    // Raw inserts: simulate pre-change rows the writers never totalled.
    for (const h of FULL) {
      for (const id of [complete, preset]) {
        await pool.query("INSERT INTO round_hole (round_id, hole_number, strokes) VALUES ($1, $2, $3)", [
          id,
          h.holeNumber,
          h.strokes,
        ]);
      }
    }
    for (const h of FULL.slice(0, 9)) {
      await pool.query("INSERT INTO round_hole (round_id, hole_number, strokes) VALUES ($1, $2, $3)", [
        partial,
        h.holeNumber,
        h.strokes,
      ]);
    }
    await pool.query("UPDATE round SET total_strokes = 999 WHERE id = $1", [preset]);

    const sql = MIGRATIONS.find((m) => m.filename === "015_round_total_strokes_backfill.sql")!.sql;
    await pool.query(sql);
    await pool.query(sql); // re-run: no-op

    expect(await totalOf(complete)).toBe(78);
    expect(await totalOf(partial)).toBeNull();
    expect(await totalOf(preset), "a non-NULL total is never overwritten").toBe(999);
  });

  it("5. the round sync writes total_strokes on import (Fox Bend 2026-06-22 = 81)", async () => {
    await syncRounds();
    const { rows } = await getPool().query<{ total_strokes: number | null }>(
      "SELECT total_strokes FROM round WHERE external_key = '2026-06-22_fox-bend'",
    );
    expect(rows[0]?.total_strokes).toBe(81);
  });
});

describe.skipIf(hasDb)("round.total_strokes DB tests (skipped - no DATABASE_URL)", () => {
  it("is skipped without DATABASE_URL - self-skip is NOT passing", () => {
    expect(hasDb).toBe(false);
  });
});
