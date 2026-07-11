import { describe, it, expect, afterAll } from "vitest";
import {
  runMigrations,
  getPool,
  createRound,
  upsertRoundHole,
  getRound,
  summarizeRound,
  FAIRWAY_RESULTS,
  DIFFERENTIAL_SOURCES,
} from "@gai/api";
import { MIGRATIONS } from "../services/api/src/migrations.generated";

// =============================================================
// Mission S3 — Stats foundation schema (migration 012).
//
// Two tiers, same file:
//   - Manifest + coupling guards run WITHOUT credentials on every test run.
//   - Constraint tests gate on DATABASE_URL (they run against the same Neon DB
//     production reads), so every fixture self-cleans before+after. Self-skip
//     is NOT passing — a run without credentials proves nothing about the DB.
// =============================================================

const hasDb = Boolean(process.env.DATABASE_URL);

const MIGRATION_012 = MIGRATIONS.find((m) => m.filename === "012_stats_foundation.sql");

// ── Tier 1: no credentials needed ────────────────────────────────────────────

describe("012 manifest + validation-layer coupling (no DB needed)", () => {
  it("012_stats_foundation.sql is in the build-time manifest (the runner will apply it on deploy)", () => {
    expect(MIGRATION_012, "012 must be embedded in migrations.generated.ts").toBeDefined();
  });

  // The D23 coupling, drift-guarded: the server-side lists in rounds.ts are
  // layer 2 of the three-layer contract (payload schema / sync validator / DB
  // CHECK). If someone widens a DB CHECK without widening the server list —
  // or vice versa — this test fails before the drift ever ships.
  it("DB CHECK lists in 012 match the server-side FAIRWAY_RESULTS / DIFFERENTIAL_SOURCES mirrors", () => {
    const sql = MIGRATION_012!.sql;
    expect(sql).toContain(
      `CHECK (fairway_result IN (${FAIRWAY_RESULTS.map((v) => `'${v}'`).join(",")}))`,
    );
    expect(sql).toContain(
      `CHECK (differential_source IN (${DIFFERENTIAL_SOURCES.map((v) => `'${v}'`).join(",")}))`,
    );
  });

  it("server lists carry the exact locked domains (design doc §3)", () => {
    expect([...FAIRWAY_RESULTS]).toEqual(["hit", "miss_left", "miss_right"]);
    expect([...DIFFERENTIAL_SOURCES]).toEqual(["cdga_posted", "computed_adjusted"]);
  });
});

// ── Tier 2: DB-gated constraint coverage ─────────────────────────────────────

describe.skipIf(!hasDb)("012 constraints against the live schema", () => {
  const fixtureCourseIds: string[] = [];

  async function makeCourse(name: string, slug?: string): Promise<string> {
    const pool = getPool();
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO course (name, slug) VALUES ($1, $2) RETURNING id",
      [name, slug ?? null],
    );
    const id = rows[0]!.id;
    fixtureCourseIds.push(id);
    return id;
  }

  afterAll(async () => {
    const pool = getPool();
    if (fixtureCourseIds.length > 0) {
      // Rounds first: round.tee_box_id is ON DELETE RESTRICT, so tee_box rows
      // (which cascade with the course) can't go while rounds still point at them.
      await pool.query("DELETE FROM round WHERE course_id = ANY($1::uuid[])", [fixtureCourseIds]);
      await pool.query("DELETE FROM course WHERE id = ANY($1::uuid[])", [fixtureCourseIds]);
    }
    await pool.query("DELETE FROM course WHERE name LIKE 'StatsS3 %'");
  });

  it("1. ledger recorded 012, and the Fox Bend row carries the backfilled slug", async () => {
    await runMigrations();
    const pool = getPool();

    const ledger = await pool.query("SELECT 1 FROM _migrations WHERE filename = $1", [
      "012_stats_foundation.sql",
    ]);
    expect(ledger.rowCount, "012 must be recorded in _migrations").toBe(1);

    const { rows } = await pool.query<{ slug: string | null }>(
      "SELECT slug FROM course WHERE name = 'Fox Bend Golf Course'",
    );
    expect(rows[0]?.slug).toBe("fox-bend");
  });

  it("2. course.slug is UNIQUE", async () => {
    await runMigrations();
    await makeCourse("StatsS3 Slug A", "stats-s3-slug");
    await expect(makeCourse("StatsS3 Slug B", "stats-s3-slug")).rejects.toThrow(
      /duplicate key/i,
    );
  });

  it("3. tee_box requires rating + slope; yardage is optional", async () => {
    await runMigrations();
    const pool = getPool();
    const courseId = await makeCourse("StatsS3 TeeBox Course");

    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO tee_box (course_id, name, rating, slope) VALUES ($1, 'Blue', 71.2, 128) RETURNING id",
      [courseId],
    );
    expect(rows[0]!.id).toMatch(/^[0-9a-f-]{36}$/);

    await expect(
      pool.query("INSERT INTO tee_box (course_id, name, slope) VALUES ($1, 'NoRating', 120)", [
        courseId,
      ]),
    ).rejects.toThrow(/not-null/i);
  });

  it("4. round → tee_box is ON DELETE RESTRICT: a tee box with logged rounds cannot be deleted", async () => {
    await runMigrations();
    const pool = getPool();
    const courseId = await makeCourse("StatsS3 Restrict Course");
    const {
      rows: [teeBox],
    } = await pool.query<{ id: string }>(
      "INSERT INTO tee_box (course_id, name, rating, slope) VALUES ($1, 'White', 71.2, 128) RETURNING id",
      [courseId],
    );

    const { roundId } = await createRound({
      courseId,
      playedDate: "2026-07-11",
      teeBoxId: teeBox!.id,
      differential: 4.2,
      differentialSource: "cdga_posted",
      externalKey: "2026-07-11_stats-s3-restrict",
    });

    // The reference table must never take round history down with it.
    await expect(pool.query("DELETE FROM tee_box WHERE id = $1", [teeBox!.id])).rejects.toThrow(
      /violates foreign key constraint/i,
    );

    // The round survived the attempt.
    expect(await getRound(roundId)).not.toBeNull();
  });

  it("5. round.differential is NOT NULL and differential_source is CHECK-constrained", async () => {
    await runMigrations();
    const pool = getPool();
    const courseId = await makeCourse("StatsS3 Differential Course");

    await expect(
      pool.query(
        `INSERT INTO round (course_id, played_date, differential_source, external_key)
         VALUES ($1, '2026-07-11', 'cdga_posted', '2026-07-11_stats-s3-nodiff')`,
        [courseId],
      ),
    ).rejects.toThrow(/not-null/i);

    await expect(
      pool.query(
        `INSERT INTO round (course_id, played_date, differential, differential_source, external_key)
         VALUES ($1, '2026-07-11', 1.5, 'guessed', '2026-07-11_stats-s3-badsource')`,
        [courseId],
      ),
    ).rejects.toThrow(/round_differential_source_check/);
  });

  it("6. external_key is UNIQUE — a duplicate maps to RoundError 409, not a 500", async () => {
    await runMigrations();
    const courseId = await makeCourse("StatsS3 ExternalKey Course");
    const input = {
      courseId,
      playedDate: "2026-07-11",
      differential: 2.1,
      differentialSource: "computed_adjusted" as const,
      externalKey: "2026-07-11_stats-s3-dupe",
    };
    await createRound(input);
    await expect(createRound(input)).rejects.toMatchObject({ status: 409 });
  });

  it("7. fairway_result is enforced at BOTH coupled layers: server 400 and DB CHECK", async () => {
    await runMigrations();
    const pool = getPool();
    const courseId = await makeCourse("StatsS3 Fairway Course");
    const { roundId } = await createRound({
      courseId,
      playedDate: "2026-07-11",
      differential: 0,
      differentialSource: "computed_adjusted",
      externalKey: "2026-07-11_stats-s3-fairway",
    });

    // Server layer (rounds.ts mirror list) rejects before SQL ever runs…
    await expect(
      upsertRoundHole(roundId, {
        holeNumber: 1,
        strokes: 4,
        // @ts-expect-error — deliberately outside the FairwayResult union.
        fairwayResult: "left",
      }),
    ).rejects.toMatchObject({ status: 400 });

    // …and the DB CHECK catches a writer that bypasses the server layer.
    await expect(
      pool.query(
        `INSERT INTO round_hole (round_id, hole_number, strokes, fairway_result)
         VALUES ($1, 2, 4, 'left')`,
        [roundId],
      ),
    ).rejects.toThrow(/round_hole_fairway_result_check/);

    // All legal values round-trip, and NULL stays legal (par 3s / legacy rows).
    await upsertRoundHole(roundId, { holeNumber: 1, strokes: 4, fairwayResult: "hit" });
    await upsertRoundHole(roundId, { holeNumber: 2, strokes: 5, fairwayResult: "miss_left" });
    await upsertRoundHole(roundId, { holeNumber: 3, strokes: 5, fairwayResult: "miss_right" });
    await upsertRoundHole(roundId, { holeNumber: 4, strokes: 3, fairwayResult: null });

    const detail = await getRound(roundId);
    expect(detail!.holes.map((h) => h.fairwayResult)).toEqual([
      "hit",
      "miss_left",
      "miss_right",
      null,
    ]);

    // summarizeRound derives the split from fairway_result: 3 known outcomes,
    // 1 hit — the NULL hole is excluded from the denominator, never binned.
    const stats = summarizeRound(detail!);
    expect(stats.fairwaysPossible).toBe(3);
    expect(stats.fairwaysHit).toBe(1);
  });

  it("8. legacy backfill invariant: every fairway_hit=true row carries fairway_result='hit'", async () => {
    await runMigrations();
    const pool = getPool();
    // fairway_hit is deprecated (no code writes it), but the column remains
    // until the cleanup migration — the 012 backfill must have mapped every
    // true to 'hit' and left every false/NULL as NULL (direction unknown).
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM round_hole
        WHERE fairway_hit = true AND fairway_result IS DISTINCT FROM 'hit'`,
    );
    expect(rows[0]!.n).toBe(0);
  });
});

describe.skipIf(hasDb)("012 constraint tests (skipped — no DATABASE_URL)", () => {
  it("is skipped without DATABASE_URL — self-skip is NOT passing", () => {
    expect(hasDb).toBe(false);
  });
});
